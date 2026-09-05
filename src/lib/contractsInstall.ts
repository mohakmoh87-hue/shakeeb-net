// ═════ 🏢📄🛠️ محرّكُ احتساب التنصيبات الداخليّة من موقع العقود (طلب محمد 2026-09-05) ═════
// كلُّ عقدٍ في الموقع = تنصيبٌ داخل المكتب، يُنسَب لشهرِ تاريخه. المطابقةُ باليوزر حصراً
// (accountNo = netUser). شرطُ الوصل (±٣ أيّام) يُطبَّق على العقود **منذ لحظة التأسيس (epoch)**
// وضمن نافذةٍ متدحرجة (٤٥ يوماً) + أيُّ عقدٍ عالقٍ (انتظار/سرقة) مهما قدُم — كي:
//   له وصل ⇒ داخليّ · بلا وصلٍ <يومين ⇒ انتظار · بلا وصلٍ ≥يومين ⇒ سرقة (حارس المال).
// العقودُ قبل التأسيس (أو الأقدم من النافذة وغيرُ العالقة): داخليّةٌ بلا فحصِ وصل.
// يعمل على **حاسبة المكتب** (على إنترنت سوبر سيل) عند أوّل نبضةٍ يوميّة عبر حجزٍ ذرّيّ.

import { prisma } from "@/lib/prisma";
import { contractsLoginAndFetch, type ContractRow } from "@/lib/contractsApi";
import { baghdadDayKey } from "@/lib/attendance";

const DAY = 86400_000;
const RECEIPT_MS = 3 * DAY; // نافذةُ الوصل ±٣ أيّام
const THEFT_GRACE_MS = 2 * DAY; // بلا وصلٍ بعد يومين ⇒ سرقة
const RECHECK_MS = 45 * DAY; // نافذةُ فحصِ الوصل المتدحرجة (تغطّي الشهرَ الحاليَّ + هامش تدحرُج)
const PENDING_TTL_MS = 20 * 60_000; // «جارٍ» — قفلُ التنفيذ بين الحاسبات
const RETRY_MS = 2 * 60_000; // تراجُعٌ قصيرٌ بعد فشلِ الجلب (كي تجرّب حاسبةٌ أخرى بسرعة)

// نصُّ التاريخ إن حمل منطقةً زمنيّة نثق بها؛ وإلّا فهو توقيتُ بغداد (UTC+3)
function parseContractDate(s: string): Date {
  if (!s) return new Date(NaN);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return new Date(s);
  const d = new Date(s.replace(" ", "T") + "Z");
  return new Date(d.getTime() - 3 * 3600_000);
}
function baghdadMonthKey(d: Date): string {
  const b = new Date(d.getTime() + 3 * 3600_000);
  return `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Row = { towerId: number; cid: number; user: string; fullName: string | null; at: Date; monthKey: string; partialType: string | null };
export type ScanResult = { outcome: "ok" | "no-accounts" | "no-reach" | "busy"; offices: number; contracts: number; internal: number; waiting: number; theft: number; removed: number; errors: string[] };

const EMPTY = (outcome: ScanResult["outcome"], errors: string[] = []): ScanResult => ({ outcome, offices: 0, contracts: 0, internal: 0, waiting: 0, theft: 0, removed: 0, errors });

const scanning = new Set<number>(); // حارسُ إعادة الدخول داخل نفس العمليّة (لكلّ وكيل)

/** الفحصُ الكامل لوكيلٍ: يجلب عقودَ كلّ مكاتبه ويحدّث contract_installs. يعمل على حاسبة المكتب. */
export async function scanAgentContracts(agentId: number): Promise<ScanResult> {
  if (scanning.has(agentId)) return EMPTY("busy");
  scanning.add(agentId);
  try {
    return await doScan(agentId);
  } finally {
    scanning.delete(agentId);
  }
}

async function doScan(agentId: number): Promise<ScanResult> {
  const now = Date.now();
  const errors: string[] = [];

  const accounts = await prisma.contractsAccount.findMany({
    where: { agentId, isDeleted: false }, select: { towerId: true, username: true, password: true },
  });
  if (!accounts.length) return EMPTY("no-accounts");

  // لحظةُ التأسيس (بدءُ العملِ بالبرنامج) — قبلها لا وصلَ يُتوقَّع (لا يُفحَص ولا يُتَّهم)
  const epochRow = await prisma.systemSetting.findFirst({ where: { type: `profitEpoch:${agentId}` }, select: { text: true } });
  const epochMs = epochRow?.text ? new Date(epochRow.text).getTime() : 0;
  const floorMs = Math.max(epochMs, now - RECHECK_MS); // فحصُ الوصل من هذا الحدّ فصاعداً

  // ١) اجلب عقودَ كلّ مكتب (كلَّ التاريخ)؛ سجّل معرّفاتِ عقود كلّ مكتبٍ نجح جلبُه (لمطابقة المحذوف)
  const all: Row[] = [];
  const fetchedIdsByTower = new Map<number, Set<number>>();
  let offices = 0;
  for (const a of accounts) {
    let rows: ContractRow[];
    try { rows = await contractsLoginAndFetch(a.username, a.password); }
    catch (e) { errors.push(`مكتب ${a.towerId}: ${(e as Error).message}`); continue; }
    offices++;
    const idset = fetchedIdsByTower.get(a.towerId) ?? new Set<number>();
    fetchedIdsByTower.set(a.towerId, idset);
    for (const r of rows) {
      const cid = Number(r.id); if (!cid) continue;
      idset.add(cid);
      const at = parseContractDate(r.createDateTime ?? "");
      if (isNaN(at.getTime())) continue;
      all.push({
        towerId: a.towerId, cid, user: (r.accountNo ?? "").trim(), fullName: r.fullName ?? null,
        at, monthKey: baghdadMonthKey(at), partialType: r.partialType ?? null,
      });
    }
  }
  if (!offices) return EMPTY("no-reach", errors);

  // ٢) إدراجٌ جماعيٌّ سريعٌ لكلّ العقود كـ«داخليّ» (المكرَّرُ يُتجاوَز) — يجعل أوّلَ تشغيلٍ دفعةً واحدة
  for (let i = 0; i < all.length; i += 1000) {
    const chunk = all.slice(i, i + 1000);
    try {
      await prisma.contractInstall.createMany({
        skipDuplicates: true,
        data: chunk.map((r) => ({
          agentId, towerId: r.towerId, contractId: r.cid, username: r.user, fullName: r.fullName,
          contractDate: r.at, monthKey: r.monthKey, partialType: r.partialType, classification: "internal",
        })),
      });
    } catch (e) { errors.push(`إدراج: ${(e as Error).message}`); }
  }

  // ٣) مطابقةُ المحذوف: عقدٌ كان لدينا لكنّه غاب عن جلبِ مكتبٍ **نجح** جلبُه ضمن النافذة ⇒ حُذف من
  //    الموقع ⇒ يُوسَم removed فيسقط من العدّ ويُغلق إنذارُه (طلبُ محمد ضمنيّاً: تصحيحُ خطأ عقد).
  let removed = 0;
  const recentFloor = new Date(now - RECHECK_MS);
  for (const [towerId, idset] of fetchedIdsByTower) {
    if (!idset.size) continue; // ردٌّ فارغٌ (ربّما شذوذٌ) ⇒ لا تمسح كلَّ عقود المكتب
    try {
      const res = await prisma.contractInstall.updateMany({
        where: { agentId, towerId, contractDate: { gte: recentFloor }, contractId: { notIn: [...idset] }, classification: { not: "removed" } },
        data: { classification: "removed", resolvedAt: new Date() },
      });
      removed += res.count;
    } catch (e) { errors.push(`مطابقة المحذوف مكتب ${towerId}: ${(e as Error).message}`); }
  }

  // ٤) العقودُ الواجبُ فحصُ وصلها: ضمن النافذة (≥ floor) **أو** أيُّ صفٍّ عالقٍ (انتظار/سرقة) مهما قدُم.
  //    (بلا يوزرٍ لا يُفحَص — لا مطابقةَ ممكنة، فيبقى داخليّاً ولا يُتَّهم بسرقةٍ أبديّة.)
  const unresolved = await prisma.contractInstall.findMany({
    where: { agentId, classification: { in: ["waiting", "theft"] }, resolvedAt: null },
    select: { contractId: true },
  });
  const unresolvedCids = new Set(unresolved.map((u) => u.contractId));

  const toCheck = all.filter((r) => r.user && (r.at.getTime() >= floorMs || unresolvedCids.has(r.cid)));
  let internal = all.length, waiting = 0, theft = 0;
  if (toCheck.length) {
    const towers = await prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } });
    const towerIds = towers.map((t) => t.id);
    const users = [...new Set(toCheck.map((r) => r.user.toLowerCase()))];
    const subs = await prisma.subscriber.findMany({
      where: { isDeleted: false, towerId: { in: towerIds }, netUser: { in: users, mode: "insensitive" } },
      select: { id: true, netUser: true },
    });
    const subByUser = new Map<string, number>();
    for (const su of subs) if (su.netUser) subByUser.set(su.netUser.toLowerCase(), su.id);
    const subIds = [...new Set(subByUser.values())];
    const minAt = Math.min(...toCheck.map((r) => r.at.getTime()));
    const recs = subIds.length
      ? await prisma.subscriptionEntry.findMany({
          where: { subscriberId: { in: subIds }, isDeleted: false, date: { gte: new Date(minAt - RECEIPT_MS) } },
          select: { subscriberId: true, date: true },
        })
      : [];
    const recBySub = new Map<number, number[]>();
    for (const e of recs) { if (e.subscriberId == null || !e.date) continue; const l = recBySub.get(e.subscriberId) ?? []; l.push(e.date.getTime()); recBySub.set(e.subscriberId, l); }

    for (const r of toCheck) {
      const sid = subByUser.get(r.user.toLowerCase()) ?? null;
      const times = sid != null ? recBySub.get(sid) ?? [] : [];
      const hitTime = times.find((t) => Math.abs(t - r.at.getTime()) <= RECEIPT_MS);
      const hasReceipt = hitTime != null;
      let classification: string;
      if (hasReceipt) classification = "internal";
      else if (now - r.at.getTime() >= THEFT_GRACE_MS) { classification = "theft"; theft++; internal--; }
      else { classification = "waiting"; waiting++; internal--; }
      try {
        await prisma.contractInstall.updateMany({
          where: { agentId, contractId: r.cid },
          data: {
            towerId: r.towerId, subscriberId: sid, hasReceipt,
            receiptAt: hasReceipt ? new Date(hitTime!) : null,
            classification, resolvedAt: hasReceipt ? new Date() : null,
          },
        });
      } catch (e) { errors.push(`تحديث ${r.cid}: ${(e as Error).message}`); }
    }
  }

  return { outcome: "ok", offices, contracts: all.length, internal, waiting, theft, removed, errors };
}

// ═════ الحجزُ الذرّيُّ اليوميّ (نمطُ claimDay مع تسويةِ السباق) — على حاسبة المكتب ═════
// المفتاحُ contractsInstallScan:{agentId} في system_settings — أوّلُ حاسبةٍ للوكيل تفوز باليوم.
type Claim = { claimed: boolean; rowId?: number };
export async function claimContractsScan(agentId: number, dayKey: string): Promise<Claim> {
  const type = `contractsInstallScan:${agentId}`;
  const now = Date.now();
  const last = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true, value: true }, orderBy: { id: "asc" } });
  if (last?.value === dayKey) return { claimed: false }; // نُفّذ اليوم
  if (last?.value?.startsWith(`${dayKey}#pending#`)) {
    const t = Number(last.value.split("#")[2]);
    if (Number.isFinite(t) && now - t < PENDING_TTL_MS) return { claimed: false }; // جارٍ الآن
  }
  const pend = `${dayKey}#pending#${now}`;
  if (last) {
    const won = await prisma.systemSetting.updateMany({ where: { id: last.id, value: last.value }, data: { value: pend } });
    return won.count === 1 ? { claimed: true, rowId: last.id } : { claimed: false };
  }
  // أوّلُ حجزٍ لهذا المفتاح: أنشئ ثمّ سَوِّ السباقَ (الأدنى id يفوز، والباقي يُحذف)
  const made = await prisma.systemSetting.create({ data: { type, value: pend }, select: { id: true } });
  const alls = await prisma.systemSetting.findMany({ where: { type }, select: { id: true }, orderBy: { id: "asc" } });
  if (alls[0]?.id !== made.id) { await prisma.systemSetting.delete({ where: { id: made.id } }).catch(() => {}); return { claimed: false }; }
  return { claimed: true, rowId: made.id };
}
const finalizeScan = (rowId: number, dayKey: string) =>
  prisma.systemSetting.update({ where: { id: rowId }, data: { value: dayKey } }).catch(() => {});
// تراجُعٌ قصير: اجعل العلامةَ تنتهي بعد RETRY_MS كي تعيد حاسبةٌ (قد تكون على الشبكة) المحاولةَ بسرعة
const backoffScan = (rowId: number, dayKey: string) =>
  prisma.systemSetting.update({ where: { id: rowId }, data: { value: `${dayKey}#pending#${Date.now() - PENDING_TTL_MS + RETRY_MS}` } }).catch(() => {});

/** يُستدعى من حلقة العامل: يفحص مرّةً/يوم/وكيل. فشلُ الوصول يُطلق تراجُعاً قصيراً لتجرّب حاسبةٌ أخرى. */
export async function maybeRunDailyContractsScan(agentId: number): Promise<void> {
  const dayKey = baghdadDayKey(new Date());
  const claim = await claimContractsScan(agentId, dayKey);
  if (!claim.claimed || claim.rowId == null) return;
  let r: ScanResult;
  try { r = await scanAgentContracts(agentId); }
  catch { await backoffScan(claim.rowId, dayKey); return; }
  if (r.outcome === "ok" || r.outcome === "no-accounts") await finalizeScan(claim.rowId, dayKey);
  else if (r.outcome === "no-reach") await backoffScan(claim.rowId, dayKey);
  // busy: عمليّةٌ أخرى على نفس الحاسبة تفحص الآن ⇒ اترك «جارٍ» فهي تُنهيه
}
