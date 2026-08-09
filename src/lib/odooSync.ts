import { prisma } from "@/lib/prisma";
import { isLeaderNow, getWorkerAgentId, getWorkerTowerId } from "@/lib/hybridAgent";
import { appendCardHistory } from "@/lib/field";
import { upsertOdooCard, refreshOdooCard, countOpenOdooCards } from "@/lib/odooCards";
import {
  odooLogin, odooFetchOpenTickets, odooReadTicket, odooReceive, odooChangeBg, odooClose, odooCancel, odooChatterPost,
  isOpenStage, isDoneStage, type OdooSession,
} from "@/lib/odoo";
import {
  slaStateOf, fillSlaText, inSlaWindow, SLA_ALARM_MIN_DEFAULT, SLA_SEND_MIN_DEFAULT,
  SLA_GRACE_MS, SLA_SEND_CAP, SLA_WA_TTL_MS, SLA_NOTE_DEFAULT, SLA_WA_DEFAULT,
} from "@/lib/odooSla";

// ===== مزامنة تذاكر أودو — تعمل على عامل حاسبة المكتب المحليّ حصراً (RUN_WORKER)، لا سحابة =====
// سحبٌ كلّ ١٠ دقائق (تذاكر جديدة id>العلامة) + دفعٌ سريعٌ كلّ ٢٠ ثانية (إنجاز/إلغاء ← أودو، «فوريّ»).
// قائد الوكيل فقط (isLeaderNow) يشغّلها لكلّ مكاتب وكيله المفعّلة — فلا تكرار، وعزلٌ صارم بالوكيل.
const PULL_MS = 10 * 60_000;
const PUSH_MS = 20_000;
const SLA_MS = 60_000; // فحص المهلة كلّ دقيقة (على القائد)
const WA_MS = 30_000; // طابور رسائل المشتركين (على حاسبة المكتب نفسها)
const SESSION_TTL = 25 * 60_000;
const CLAIM_TTL_MS = 5 * 60_000; // حجزٌ عالقٌ (انقطاعٌ وسط النداء) يسقط بعد ٥ دقائق

type OfficeRow = {
  id: number; name: string | null; odooUser: string | null; odooPass: string | null; odooUrl: string | null;
  odooLastTicketId: number | null; odooEnabled: string | null; odooUid: number | null;
  odooSlaAuto: string | null; odooSlaArmedAt: Date | null;
  odooSlaAlarmMin: number | null; odooSlaSendMin: number | null;
  odooSlaNote: string | null; odooSlaWaText: string | null;
};

const sessionCache = new Map<number, { s: OdooSession; at: number }>();
let pulling = false;
let pushing = false;
let slaBusy = false;
let waBusy = false;

async function officeSession(o: OfficeRow): Promise<OdooSession> {
  const now = Date.now();
  const c = sessionCache.get(o.id);
  if (c && now - c.at < SESSION_TTL) return c.s;
  const pass = o.odooPass ?? ""; // نصٌّ صريح (كـSAS) — العامل لا يملك مفتاح التشفير
  const s = await odooLogin(o.odooUrl, o.odooUser ?? "", pass);
  sessionCache.set(o.id, { s, at: now });
  return s;
}

// مكاتب الوكيل ذات بيانات أودو (لها user+pass)
async function offices(agentId: number): Promise<OfficeRow[]> {
  return prisma.tower.findMany({
    where: { agentId, isDeleted: false, odooUser: { not: null }, odooPass: { not: null } },
    select: {
      id: true, name: true, odooUser: true, odooPass: true, odooUrl: true, odooLastTicketId: true, odooEnabled: true, odooUid: true,
      odooSlaAuto: true, odooSlaArmedAt: true, odooSlaAlarmMin: true, odooSlaSendMin: true, odooSlaNote: true, odooSlaWaText: true,
    },
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

// آخر ملاحظة تأجيل من سجلّ البطاقة (يخزّنها مسار postpone كـ«تأجيل البطاقة إلى … — {note}»)
function postponeNoteFromHistory(history: string | null): string | null {
  if (!history) return null;
  try {
    const arr = JSON.parse(history) as { text?: string }[];
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = String(arr[i]?.text ?? "").match(/تأجيل البطاقة[^—\n]*—\s*(.+)$/);
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

        // (١) مسحٌ شامل كلّ دورة: كلّ التذاكر المفتوحة المُسنَدة للمكتب — **بلا قيد العلامة**.
        // يلتقط الجديد، و**يعيد إنشاء بطاقةٍ حُذفت وتذكرتها ما زالت مفتوحة** (كي لا تبقى معلّقةً
        // في أودو بلا Done/Cancel — طلب محمد)، و**يُحدّث البطاقات القائمة** (إلزاميّة اليوزر/الهاتف/bg).
        // المعطّل (drain): تحديث القائم فقط — لا بطاقات جديدة.
        const tickets = await odooFetchOpenTickets(s, 0);
        const openById = new Map<number, (typeof tickets)[number]>();
        let maxId = o.odooLastTicketId ?? 0;
        for (const t of tickets) {
          maxId = Math.max(maxId, t.id);
          // حارس المصدر: مُسنَد لحساب المكتب حصراً
          if (t.assignedUid != null && t.assignedUid !== s.uid) continue;
          if (isDoneStage(t.stageName) || !isOpenStage(t.stageName)) continue; // المنجزة/المنتهية تُتجاهَل
          openById.set(t.id, t);
          const existing = await prisma.taskCard.findFirst({ where: { odooTicketId: t.id, isDeleted: false }, select: { id: true } });
          if (existing) { await refreshOdooCard(existing.id, t); continue; } // قائمة ⇒ تحديثٌ فقط
          if (!enabled) continue; // drain: لا إنشاء
          // Change Team ⇒ رسيف تلقائيّ؛ In Progres ⇒ بلا رسيف (مُستلَمٌ مسبقاً)
          if (t.stageName.trim().toLowerCase() === "change team") {
            try { await odooReceive(s, t.id); } catch { /* لا يمنع الإنشاء */ }
          }
          await upsertOdooCard(o.id, t);
        }
        if (maxId > (o.odooLastTicketId ?? 0)) await prisma.tower.update({ where: { id: o.id }, data: { odooLastTicketId: maxId } });

        // (٢) مصالحة: بطاقات مفتوحة تذاكرها **ليست** ضمن المفتوح المسحوب ⇒ تحقّقٌ مباشر (أُغلقت خارجيّاً؟)
        const listIds = await listIdsOf(o.id);
        if (listIds.length) {
          const open = await prisma.taskCard.findMany({
            where: { listId: { in: listIds }, viaOdoo: true, odooTicketId: { not: null }, done: false, settled: false, isDeleted: false, archivedAt: null },
            select: { id: true, odooTicketId: true }, take: 40,
          });
          for (const c of open) {
            if (openById.has(c.odooTicketId as number)) continue; // ما زالت مفتوحةً — حُدّثت أعلاه
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

// ===== مهلة سوبر سيل (كلّ دقيقة، على القائد): ملاحظة التأجيل إلى أودو =====
// سوبر سيل تُغرّم إن مضت ساعتان بلا إجراء. المسار هنا شقّان:
//   (أ) **تأجيلٌ يدويّ** لبطاقة أودو ⇒ تُدفَع ملاحظة الفنيّ إلى أودو (الربط الثلاثيّ المتّفق عليه:
//       إنجاز=close · إلغاء=cancel · تأجيل=ملاحظة). يُدفَع دائماً، بلا علاقةٍ بمفتاح التلقائيّ.
//   (ب) **تأجيلٌ تلقائيّ** عند تجاوز عتبة الإرسال (٩٠ دقيقةَ نافذة) بنصّ المدير — بشروطٍ صارمة:
//       مفتاح التلقائيّ مُشعَل، والبطاقة سُحبت **بعد** لحظة التسليح (فلا رشقةَ تذاكرَ قديمة لحظة
//       التشعيل)، ومضت مهلة رؤية ١٠ دقائق على سحبها، وبسقف ٥ رسائل للمكتب في الدورة.
// الترتيب إلزاميّ: **أودو أوّلاً** (فعلٌ قابل للتكرار) ثمّ إدراج الواتساب في الطابور — كي لا يُبلَّغ
// المشترك بتأجيلٍ لا تعلمه أودو (فتقع الغرامة والمشترك مُبلَّغ).
async function runSlaSweep(): Promise<void> {
  if (slaBusy) return; slaBusy = true;
  try {
    if (!isLeaderNow()) return;
    const agentId = getWorkerAgentId();
    if (agentId == null) return;
    for (const o of await offices(agentId)) {
      const listIds = await listIdsOf(o.id);
      if (!listIds.length) continue;
      const cards = await prisma.taskCard.findMany({
        where: {
          listId: { in: listIds }, viaOdoo: true, odooTicketId: { not: null },
          done: false, settled: false, isDeleted: false, archivedAt: null, slaNoteAt: null,
        },
        select: {
          id: true, odooTicketId: true, odooCreatedAt: true, odooFetchedAt: true, createdAt: true,
          postponedTo: true, odooPhone: true, odooBg: true, history: true,
        },
        take: 60,
      });
      if (!cards.length) continue;

      const alarmMin = o.odooSlaAlarmMin ?? SLA_ALARM_MIN_DEFAULT;
      const sendMin = o.odooSlaSendMin ?? SLA_SEND_MIN_DEFAULT;
      const armed = o.odooSlaAuto === "1" && o.odooSlaArmedAt != null;
      const now = new Date();

      type Due = { id: number; ticketId: number; phone: string | null; bg: string | null; manual: boolean; note: string };
      const due: Due[] = [];
      for (const c of cards) {
        const base = { id: c.id, ticketId: c.odooTicketId as number, phone: c.odooPhone, bg: c.odooBg };
        if (c.postponedTo) {
          // (أ) أُجّلت يدويّاً: تُدفَع ملاحظة الفنيّ. بطاقةٌ قديمة أُجّلت بلا ملاحظة ⇒ لا شيء يُدفَع.
          const n = postponeNoteFromHistory(c.history);
          if (n) due.push({ ...base, manual: true, note: n });
          continue;
        }
        if (!armed) continue;
        const fetched = c.odooFetchedAt ?? c.createdAt;
        if (o.odooSlaArmedAt && fetched.getTime() < o.odooSlaArmedAt.getTime()) continue; // ما سُحب قبل التسليح
        if (now.getTime() - fetched.getTime() < SLA_GRACE_MS) continue; // مهلة الرؤية
        const st = slaStateOf({ ...c, viaOdoo: true }, now, alarmMin, sendMin);
        if (st.ageMin < sendMin) continue;
        const note = fillSlaText((o.odooSlaNote ?? "").trim() || SLA_NOTE_DEFAULT, {
          office: o.name, ticket: base.ticketId, phone: base.phone, bg: base.bg,
        });
        due.push({ ...base, manual: false, note: note || SLA_NOTE_DEFAULT });
      }
      if (!due.length) continue;

      let s: OdooSession;
      try { s = await officeSession(o); }
      catch (e) {
        sessionCache.delete(o.id);
        await prisma.tower.update({ where: { id: o.id }, data: { odooLastOk: null, odooLastError: String((e as Error).message ?? "خطأ").slice(0, 200) } }).catch(() => {});
        continue; // الإنذار يبقى مشتعلاً — لم يُبلَّغ أودو
      }

      let autoSent = 0;
      for (const d of due) {
        if (!d.manual && autoSent >= SLA_SEND_CAP) break; // السقف للتلقائيّ فقط
        // ختمٌ على مستوى **التذكرة** لا البطاقة: بطاقةٌ حُذفت فأُعيد إنشاؤها (السحب يعيدها بطلب
        // محمد) لا تُبلَّغ مرّتين — نفحص كلّ بطاقات هذه التذكرة ولو كانت محذوفة.
        const already = await prisma.taskCard.count({ where: { odooTicketId: d.ticketId, slaNoteAt: { not: null } } });
        if (already > 0) {
          await prisma.taskCard.update({ where: { id: d.id }, data: { slaNoteAt: new Date() } }).catch(() => {});
          continue;
        }
        // حجزٌ ذرّيّ **قبل** أيّ نداء شبكة: يمنع إرسالاً مزدوجاً لحظة انتقال القيادة بين حاسبتين
        const claim = await prisma.taskCard.updateMany({
          where: {
            id: d.id, slaNoteAt: null,
            OR: [{ slaClaimedAt: null }, { slaClaimedAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) } }],
          },
          data: { slaClaimedAt: new Date() },
        });
        if (claim.count !== 1) continue; // حاسبةٌ أخرى تُعالجها الآن
        try {
          const tk = await odooReadTicket(s, d.ticketId);
          await odooChatterPost(s, d.ticketId, d.note, tk?.accessToken ?? null);
          // التأجيل التلقائيّ يُبلّغ المشترك؛ واليدويّ لا (المكتب كلّمه فعلاً قبل أن يؤجّل)
          const queueWa = !d.manual && !!d.phone;
          await prisma.taskCard.update({
            where: { id: d.id },
            data: { slaNoteAt: new Date(), ...(queueWa ? { slaWaQueuedAt: new Date() } : {}) },
          });
          await appendCardHistory(d.id, "أودو", d.manual
            ? `دُفِعت ملاحظة التأجيل إلى أودو — ${d.note}`
            : `⏳ تأجيلٌ تلقائيّ (تجاوز ${sendMin}د): دُفِعت الملاحظة إلى أودو${queueWa ? " وأُدرجت رسالة المشترك في الطابور" : d.phone ? "" : " — لا هاتف في التذكرة"}`);
          if (!d.manual) autoSent++;
        } catch (e) {
          // فشل أودو ⇒ يُفكّ الحجز فتُعاد المحاولة، ولا واتساب إطلاقاً، والإنذار يبقى مشتعلاً
          await prisma.taskCard.update({ where: { id: d.id }, data: { slaClaimedAt: null } }).catch(() => {});
          await appendCardHistory(d.id, "أودو", `تعذّر إبلاغ أودو بالتأجيل: ${String((e as Error).message ?? "").slice(0, 120)}`).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error("[odoo-sla] sweep:", e instanceof Error ? e.message : e);
  } finally { slaBusy = false; }
}

// ===== طابور رسائل المشتركين (كلّ ٣٠ث، على **حاسبة المكتب نفسها** لا القائد) =====
// جلسة الواتساب مربوطةٌ بحاسبة مكتبها، فما دامت مطفأةً تبقى الرسالة مؤرشفةً على البطاقة
// وتُرسَل لحظة فتحها. وتُلغى بعد يومٍ كامل (قرار محمد) بشارةٍ على البطاقة.
async function runWaQueue(): Promise<void> {
  if (waBusy) return; waBusy = true;
  try {
    const agentId = getWorkerAgentId();
    const towerId = getWorkerTowerId();
    if (agentId == null || towerId == null) return; // حاسبةٌ غير مربوطةٍ بمكتب لا تُرسل
    // عزل: المكتب يتبع وكيل هذه الحاسبة
    const office = await prisma.tower.findFirst({ where: { id: towerId, agentId, isDeleted: false }, select: { id: true, name: true, odooSlaWaText: true } });
    if (!office) return;
    const listIds = await listIdsOf(towerId);
    if (!listIds.length) return;
    const rows = await prisma.taskCard.findMany({
      where: { listId: { in: listIds }, viaOdoo: true, slaWaQueuedAt: { not: null }, slaWaSentAt: null, isDeleted: false },
      select: { id: true, odooTicketId: true, odooPhone: true, odooBg: true, slaWaQueuedAt: true },
      take: 20,
    });
    for (const c of rows) {
      const queuedAt = c.slaWaQueuedAt as Date;
      if (Date.now() - queuedAt.getTime() > SLA_WA_TTL_MS) {
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaQueuedAt: null, slaWaError: "أُلغيت — مضى يومٌ قبل فتح حاسبة المكتب" } });
        await appendCardHistory(c.id, "أودو", "أُلغيت رسالة المشترك — مضى يومٌ على تأجيلها").catch(() => {});
        continue;
      }
      if (!c.odooPhone) {
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaQueuedAt: null, slaWaError: "لا هاتف في التذكرة" } });
        continue;
      }
      if (!inSlaWindow()) return; // خارج نافذة ١٠:٠٠←٢٤:٠٠ لا إرسال (لا رسالةَ الثالثة فجراً)
      // حجزٌ ذرّيّ قبل الإرسال — الواتساب فعلٌ لا رجعة فيه
      const claim = await prisma.taskCard.updateMany({ where: { id: c.id, slaWaSentAt: null }, data: { slaWaSentAt: new Date() } });
      if (claim.count !== 1) continue;
      const text = fillSlaText((office.odooSlaWaText ?? "").trim() || SLA_WA_DEFAULT, {
        office: office.name, ticket: c.odooTicketId, phone: c.odooPhone, bg: c.odooBg,
      });
      const { sendWhatsApp } = await import("@/lib/whatsapp");
      const res = await sendWhatsApp(towerId, c.odooPhone, text);
      if (res.ok) {
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaQueuedAt: null, slaWaError: null } });
        // سجلّ الرسائل: agentId صريحٌ للعزل (هاتف التذكرة قد لا يكون مشتركاً عندنا)
        await prisma.message.create({
          data: { channel: "WHATSAPP", phone: c.odooPhone, text, status: "SENT", createdByUser: "أودو-مهلة", agentId },
        }).catch(() => {});
        await appendCardHistory(c.id, "أودو", `أُرسلت رسالة التأجيل إلى المشترك (${c.odooPhone})`).catch(() => {});
      } else {
        // تبقى في الطابور لتُعاد المحاولة (حتى انتهاء اليوم) — والسبب ظاهرٌ على البطاقة
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaSentAt: null, slaWaError: String(res.error ?? "تعذّر الإرسال").slice(0, 160) } });
      }
    }
  } catch (e) {
    console.error("[odoo-sla] wa-queue:", e instanceof Error ? e.message : e);
  } finally { waBusy = false; }
}

export function startOdooSync(): void {
  const g = globalThis as unknown as { __odooSyncStarted?: boolean };
  if (g.__odooSyncStarted) return;
  g.__odooSyncStarted = true;
  setTimeout(() => { void runPull(); }, 60_000); // أوّل سحب بعد استقرار الإقلاع (يلتقط ما فات أثناء الإطفاء)
  setInterval(() => { void runPull(); }, PULL_MS);
  setInterval(() => { void runPush(); }, PUSH_MS);
  setInterval(() => { void runSlaSweep(); }, SLA_MS);
  setInterval(() => { void runWaQueue(); }, WA_MS);
  console.log("[odoo-sync] بدأت مزامنة تذاكر أودو (سحب 10د · دفع 20ث · مهلة 1د · طابور المشتركين 30ث) — محليّ على العامل");
}
