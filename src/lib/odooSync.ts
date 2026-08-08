import { prisma } from "@/lib/prisma";
import { isLeaderNow, getWorkerAgentId } from "@/lib/hybridAgent";
import { decryptSecret } from "@/lib/secretbox";
import { appendCardHistory } from "@/lib/field";
import { upsertOdooCard, countOpenOdooCards } from "@/lib/odooCards";
import {
  odooLogin, odooFetchOpenTickets, odooReadTicket, odooReceive, odooChangeBg, odooClose, odooCancel, odooChatterPost,
  isOpenStage, isDoneStage, type OdooSession,
} from "@/lib/odoo";

// ===== مزامنة تذاكر أودو — تعمل على عامل حاسبة المكتب المحليّ حصراً (RUN_WORKER)، لا سحابة =====
// سحبٌ كلّ ١٠ دقائق (تذاكر جديدة id>العلامة) + دفعٌ سريعٌ كلّ ٢٠ ثانية (إنجاز/إلغاء ← أودو، «فوريّ»).
// قائد الوكيل فقط (isLeaderNow) يشغّلها لكلّ مكاتب وكيله المفعّلة — فلا تكرار، وعزلٌ صارم بالوكيل.
const PULL_MS = 10 * 60_000;
const PUSH_MS = 20_000;
const SESSION_TTL = 25 * 60_000;

type OfficeRow = {
  id: number; odooUser: string | null; odooPass: string | null; odooUrl: string | null;
  odooLastTicketId: number | null; odooEnabled: string | null; odooUid: number | null;
};

const sessionCache = new Map<number, { s: OdooSession; at: number }>();
let pulling = false;
let pushing = false;

async function officeSession(o: OfficeRow): Promise<OdooSession> {
  const now = Date.now();
  const c = sessionCache.get(o.id);
  if (c && now - c.at < SESSION_TTL) return c.s;
  const pass = decryptSecret(o.odooPass) ?? "";
  const s = await odooLogin(o.odooUrl, o.odooUser ?? "", pass);
  sessionCache.set(o.id, { s, at: now });
  return s;
}

// مكاتب الوكيل ذات بيانات أودو (لها user+pass)
async function offices(agentId: number): Promise<OfficeRow[]> {
  return prisma.tower.findMany({
    where: { agentId, isDeleted: false, odooUser: { not: null }, odooPass: { not: null } },
    select: { id: true, odooUser: true, odooPass: true, odooUrl: true, odooLastTicketId: true, odooEnabled: true, odooUid: true },
  });
}

// مكتب «أودو نشط»؟ = مفعّل، أو معطّل لكن به بطاقات أودو مفتوحة (drain حتى إنجاز آخرها)
async function isActive(o: OfficeRow): Promise<boolean> {
  if (o.odooEnabled === "1") return true;
  return (await countOpenOdooCards(o.id)) > 0;
}

// آخر ملاحظة إلغاء من سجلّ البطاقة (يخزّنها مسار cancel كـ«إلغاء البطاقة — {note}»)
function cancelNoteFromHistory(history: string | null): string | null {
  if (!history) return null;
  try {
    const arr = JSON.parse(history) as { text?: string }[];
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = String(arr[i]?.text ?? "").match(/إلغاء البطاقة\s*—\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch { /* تجاهل */ }
  return null;
}

async function listIdsOf(towerId: number): Promise<number[]> {
  const board = await prisma.taskBoard.findFirst({ where: { towerId, isDeleted: false }, select: { id: true } });
  if (!board) return [];
  const lists = await prisma.taskList.findMany({ where: { boardId: board.id, isDeleted: false }, select: { id: true } });
  return lists.map((l) => l.id);
}

// ===== السحب (كلّ ١٠د): تذاكر جديدة + رسيف Change Team + إنشاء بطاقات + مصالحة القائمة =====
async function runPull(): Promise<void> {
  if (pulling) return; pulling = true;
  try {
    if (!isLeaderNow()) return;
    const agentId = getWorkerAgentId();
    if (agentId == null) return;
    for (const o of await offices(agentId)) {
      if (!(await isActive(o))) continue; // معطّل بلا بطاقات مفتوحة ⇒ لا مزامنة
      const enabled = o.odooEnabled === "1";
      try {
        const s = await officeSession(o);
        // نجاح الدخول ⇒ الشارة خضراء + uid
        await prisma.tower.update({ where: { id: o.id }, data: { odooLastOk: new Date(), odooLastError: null, ...(o.odooUid == null ? { odooUid: s.uid } : {}) } });

        // (١) جلب الجديد — للمفعّل فقط (المعطّل في وضع drain لا يجلب جديداً)
        if (enabled) {
          const since = o.odooLastTicketId ?? 0;
          const tickets = await odooFetchOpenTickets(s, since);
          let maxId = since;
          for (const t of tickets) {
            maxId = Math.max(maxId, t.id);
            // حارس المصدر: مُسنَد لحساب المكتب حصراً
            if (t.assignedUid != null && t.assignedUid !== s.uid) continue;
            if (isDoneStage(t.stageName) || !isOpenStage(t.stageName)) continue; // المنجزة/المنتهية تُتجاهَل
            // Change Team ⇒ رسيف تلقائيّ؛ In Progres ⇒ بلا رسيف (مُستلَمٌ مسبقاً)
            if (t.stageName.trim().toLowerCase() === "change team") {
              try { await odooReceive(s, t.id); } catch { /* لا يمنع الإنشاء */ }
            }
            await upsertOdooCard(o.id, t);
          }
          if (maxId > since) await prisma.tower.update({ where: { id: o.id }, data: { odooLastTicketId: maxId } });
        }

        // (٢) مصالحة البطاقات المفتوحة: أُغلقت خارجيّاً في أودو ⇒ أغلقها عندنا (drain وغيره)
        const listIds = await listIdsOf(o.id);
        if (listIds.length) {
          const open = await prisma.taskCard.findMany({
            where: { listId: { in: listIds }, viaOdoo: true, odooTicketId: { not: null }, done: false, settled: false, isDeleted: false, archivedAt: null },
            select: { id: true, odooTicketId: true }, take: 40,
          });
          for (const c of open) {
            try {
              const tk = await odooReadTicket(s, c.odooTicketId as number);
              if (tk && isDoneStage(tk.stageName)) {
                await prisma.taskCard.update({ where: { id: c.id }, data: { done: true, completedAt: new Date(), techNote: "أُنجزت/أُغلقت خارجيّاً في أودو", odooPushedAt: new Date() } });
                await appendCardHistory(c.id, "أودو", `أُغلقت خارجيّاً في أودو (${tk.stageName})`);
              }
            } catch { /* تذكرة واحدة — تجاهل */ }
          }
        }
      } catch (e) {
        sessionCache.delete(o.id);
        await prisma.tower.update({ where: { id: o.id }, data: { odooLastOk: null, odooLastError: String((e as Error).message ?? "خطأ").slice(0, 200) } }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("[odoo-sync] pull:", e instanceof Error ? e.message : e);
  } finally { pulling = false; }
}

// ===== الدفع (كلّ ٢٠ث، «فوريّ»): بطاقات أودو منجَزة/ملغاة لم تُدفَع ← أودو =====
async function runPush(): Promise<void> {
  if (pushing) return; pushing = true;
  try {
    if (!isLeaderNow()) return;
    const agentId = getWorkerAgentId();
    if (agentId == null) return;
    for (const o of await offices(agentId)) {
      const listIds = await listIdsOf(o.id);
      if (!listIds.length) continue;
      const pending = await prisma.taskCard.findMany({
        where: {
          listId: { in: listIds }, viaOdoo: true, odooTicketId: { not: null }, odooPushedAt: null,
          isDeleted: false, OR: [{ done: true }, { settled: true }],
        },
        select: { id: true, odooTicketId: true, done: true, settled: true, serviceDetails: true, techNote: true, odooBg: true, history: true },
        take: 25,
      });
      if (!pending.length) continue; // الحالة الشائعة: لا شيء ليُدفَع ⇒ بلا دخولٍ لأودو (زهيد)

      let s: OdooSession;
      try { s = await officeSession(o); }
      catch (e) { await prisma.tower.update({ where: { id: o.id }, data: { odooLastOk: null, odooLastError: String((e as Error).message ?? "خطأ").slice(0, 200) } }).catch(() => {}); continue; }

      for (const c of pending) {
        const ticketId = c.odooTicketId as number;
        try {
          const note = (c.serviceDetails && c.serviceDetails.trim()) || (c.techNote && c.techNote.trim()) || cancelNoteFromHistory(c.history) || (c.done ? "أُنجزت" : "أُلغيت");
          const tk = await odooReadTicket(s, ticketId);
          const accessToken = tk?.accessToken ?? null;
          if (c.done) {
            // إنجاز: BG (إن وُجد) ← ملاحظة ← close
            if (c.odooBg && c.odooBg.trim()) { try { await odooChangeBg(s, ticketId, c.odooBg.trim()); } catch { /* الملاحظة والإغلاق أهمّ */ } }
            await odooChatterPost(s, ticketId, note, accessToken);
            await odooClose(s, ticketId);
          } else {
            // إلغاء: ملاحظة ← cancel
            await odooChatterPost(s, ticketId, note, accessToken);
            await odooCancel(s, ticketId);
          }
          await prisma.taskCard.update({ where: { id: c.id }, data: { odooPushedAt: new Date() } });
          await appendCardHistory(c.id, "أودو", c.done ? "دُفِع الإنجاز إلى أودو (close)" : "دُفِع الإلغاء إلى أودو (cancel)");
        } catch (e) {
          // فشل الدفع: تبقى odooPushedAt=null لإعادة المحاولة (مقاومة الإطفاء/الانقطاع)
          await appendCardHistory(c.id, "أودو", `تعذّر الدفع إلى أودو: ${String((e as Error).message ?? "").slice(0, 120)}`).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error("[odoo-sync] push:", e instanceof Error ? e.message : e);
  } finally { pushing = false; }
}

export function startOdooSync(): void {
  const g = globalThis as unknown as { __odooSyncStarted?: boolean };
  if (g.__odooSyncStarted) return;
  g.__odooSyncStarted = true;
  setTimeout(() => { void runPull(); }, 60_000); // أوّل سحب بعد استقرار الإقلاع (يلتقط ما فات أثناء الإطفاء)
  setInterval(() => { void runPull(); }, PULL_MS);
  setInterval(() => { void runPush(); }, PUSH_MS);
  console.log("[odoo-sync] بدأت مزامنة تذاكر أودو (سحب كل 10د، دفع كل 20ث) — محليّ على العامل");
}
