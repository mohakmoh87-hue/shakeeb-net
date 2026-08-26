import { prisma } from "@/lib/prisma";
import { isOfferPackage } from "@/lib/syncLog";

// ═════ 📈 أرباحُ الشركة — حسابٌ للقراءة لا قيدٌ ماليّ (طلبُ محمد 2026-08-22) ═════
//
// شرطُ محمد الأوّل: «بدون المساس أو تغيير أيّ كود، يكون عملُه مستقلّاً وبدون أيّ أثرٍ
// ماليّ — فالأرباحُ وهميّةٌ للقراءة فقط». فلا يكتب هذا الملفُّ في أيّ جدولٍ ماليّ إطلاقاً:
// لا وصلَ ولا دينَ ولا قيدَ صندوق. يقرأ ما هو موجودٌ أصلاً (الوصولات · سجلّ المزامنة ·
// الباقات) ويحسب لحظةَ العرض. والجديدُ الوحيدُ في القاعدة: **قواعدُ الربح** (إعداداتُك).
//
// وشرطُه الثاني: «يبدأ كلُّ شيءٍ من الآن ولا أريد إضافةَ أيّ شيءٍ قديم» ⇒ لحظةُ التأسيس
// تُحفَظ مرّةً واحدةً (`profitEpoch`) ولا يُحسَب ما قبلها أبداً مهما اتّسع المدى المطلوب.

/** مفاتيحُ الحالة في `system_settings` — لكلّ وكيلٍ على حِدة (عزل) */
const EPOCH_KEY = (agentId: number) => `profitEpoch:${agentId}`;
const PERIOD_KEY = (agentId: number) => `profitPeriod:${agentId}`;

const DAY = 86400_000;
/** ±٣ أيّامٍ بين وقت التفعيل ووصلِ البرنامج (قرارُ محمد) */
export const ACT_RECEIPT_MS = 3 * DAY;
/** ٧ أيّامٍ **بعد** التنصيب لظهور وصله (قرارُ محمد) */
export const INSTALL_RECEIPT_MS = 7 * DAY;

/** رقمُ الكابينة من اليوزر: `bg-**47**-33-1@shu` ⇒ 47 (نفسُ اشتقاق `cabinetOf` في سجلّ المزامنة) */
export function cabinetOfUser(netUser: string | null | undefined): number {
  const m = (netUser ?? "").trim().toLowerCase().match(/^bg-(\d+)-/);
  return m ? Number(m[1]) : 0;
}

// ───────────────────────── قواعدُ الربح ─────────────────────────

export type RuleRow = {
  towerId: number; cabinet: number; kind: string; packageId: number;
  mode: string | null; percent: number | null; amount: number | null;
};

/**
 * ثلاثُ طبقاتٍ ترث: **الكابينة ← المكتب ← العامّ**. تُقرأ مرّةً وتُحلّ في الذاكرة،
 * فمئاتُ الخانات تصير قاعدةً واحدةً واستثناءاتٍ قليلة.
 */
export class Rules {
  private byKey = new Map<string, RuleRow>();
  constructor(rows: RuleRow[]) {
    for (const r of rows) this.byKey.set(`${r.towerId}|${r.cabinet}|${r.kind}|${r.packageId}`, r);
  }
  /** أقربُ قاعدةٍ للنطاق: الكابينة ثمّ المكتب ثمّ العامّ */
  private pick(towerId: number, cabinet: number, kind: string, packageId: number): RuleRow | undefined {
    return this.byKey.get(`${towerId}|${cabinet}|${kind}|${packageId}`)
      ?? this.byKey.get(`${towerId}|0|${kind}|${packageId}`)
      ?? this.byKey.get(`0|0|${kind}|${packageId}`);
  }
  /** نمطُ ربح التفعيل في هذا النطاق (صفُّ الرأس بـpackageId=0) */
  actMode(towerId: number, cabinet: number): { mode: "percent" | "fixed"; percent: number } {
    const head = this.pick(towerId, cabinet, "act", 0);
    return {
      mode: head?.mode === "fixed" ? "fixed" : "percent",
      percent: Number(head?.percent ?? 0),
    };
  }
  /** ربحُ **شهرٍ واحد** من تفعيلٍ لهذه الباقة في هذا النطاق */
  actPerMonth(towerId: number, cabinet: number, packageId: number, packagePrice: number): number {
    const m = this.actMode(towerId, cabinet);
    if (m.mode === "percent") return Math.round((packagePrice * m.percent) / 100);
    return Math.round(Number(this.pick(towerId, cabinet, "act", packageId)?.amount ?? 0));
  }
  /** ربحُ تنصيبٍ (مرّةً واحدةً) — داخليٌّ أو خارجيّ */
  installProfit(towerId: number, cabinet: number, packageId: number, external: boolean): number {
    return Math.round(Number(this.pick(towerId, cabinet, external ? "instExt" : "instIn", packageId)?.amount ?? 0));
  }
  /**
   * الاستقطاعُ لهذه الباقة — **رقمان مختلفان** (تصحيحُ محمد 2026-08-22):
   * «الاستقطاعُ ليس لنوعَي التنصيب، بل التنصيبُ داخل المكتب يختلف عن التنصيب خارجه».
   * ويُطرَح من الصافي في الحالتين.
   */
  deduction(towerId: number, cabinet: number, packageId: number, external: boolean): number {
    return Math.round(Number(this.pick(towerId, cabinet, external ? "deductExt" : "deductIn", packageId)?.amount ?? 0));
  }
}

const tableMissing = (e: unknown) =>
  typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2021";

export async function loadRules(agentId: number): Promise<{ rules: Rules; dormant: boolean; rows: RuleRow[] }> {
  try {
    const rows = await prisma.profitRule.findMany({
      where: { agentId },
      select: { towerId: true, cabinet: true, kind: true, packageId: true, mode: true, percent: true, amount: true },
    });
    return { rules: new Rules(rows), dormant: false, rows };
  } catch (e) {
    if (tableMissing(e)) return { rules: new Rules([]), dormant: true, rows: [] };
    throw e;
  }
}

// ───────────────────────── الفترةُ الشهريّة ─────────────────────────

const AR_MONTHS = ["الأوّل", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
const BAGHDAD = 3 * 3600_000;

/** أجزاءُ التاريخ بتوقيت بغداد (الشهرُ والسنةُ واليوم كما يراها محمد لا كما يراها الخادم) */
function bg(d: Date) {
  const x = new Date(d.getTime() + BAGHDAD);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), day: x.getUTCDate() };
}
/** لحظةُ بدايةِ يومٍ بتوقيت بغداد كـUTC */
function bgStart(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, 0, 0, 0) - BAGHDAD);
}
/** آخرُ لحظةٍ في شهرٍ بتوقيت بغداد */
function bgMonthEnd(y: number, m: number): Date {
  return new Date(Date.UTC(y, m + 1, 1, 0, 0, 0) - BAGHDAD - 1);
}
/** عددُ أيّام شهرٍ فعليّاً (٢٨/٢٩/٣٠/٣١) */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
/**
 * 📅 **الوضعُ الشهريّ** (طلبُ محمد): يُختار الشهرُ فتُضبَط البدايةُ والنهايةُ وحدَهما —
 * بلا كتابةِ تاريخٍ، فكلُّ شهرٍ عددُ أيّامه معروف (٢٨/٢٩/٣٠/٣١). ولا تحذيرَ فيه أبداً.
 */
export function monthRange(y: number, m: number): { from: Date; to: Date } {
  return { from: bgStart(y, m, 1), to: bgMonthEnd(y, m) };
}

/** أجزاءُ التاريخ بتوقيت بغداد — يحتاجها المسارُ لتسمية الشهر المختار */
export function baghdadParts(d: Date): { y: number; m: number; day: number } {
  return bg(d);
}

/** «أرباحُ الشهر الثامن» — اسمُ الشهر الذي تقع فيه بدايةُ الفترة */
export function monthLabel(from: Date): string {
  return `أرباحُ الشهر ${AR_MONTHS[bg(from).m]}`;
}

async function readSetting(type: string): Promise<string | null> {
  const row = await prisma.systemSetting.findFirst({ where: { type }, select: { text: true } });
  return row?.text ?? null;
}
async function writeSetting(type: string, text: string): Promise<void> {
  const row = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true } });
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
}

// ═════ 💾 «اختيارُ العرض» يثبت على الحساب (طلبُ محمد 2026-08-22) ═════
// «في كلّ مرّةٍ أخرج وأعود يرجع إلى الفترة الجارية» — فصار الاختيارُ (شهريٌّ أو مخصَّصٌ
// أو الشهرُ الجاري، ومعه المكتبُ) يُحفَظ **لكلّ مستخدمٍ على حِدة** ويُستعاد عند الفتح.
// ولماذا على الحساب لا على الجهاز؟ لأنّه يفتحها من الهاتف ومن المتصفّح — فيلزم أن تتبعه.
export type SavedView = { mode?: string; month?: string; from?: string; to?: string; tower?: number };

export async function getSavedView(userId: number): Promise<SavedView | null> {
  const txt = await readSetting(`profitView:${userId}`);
  if (!txt) return null;
  try { return JSON.parse(txt) as SavedView; } catch { return null; }
}
export async function saveView(userId: number, v: SavedView): Promise<void> {
  await writeSetting(`profitView:${userId}`, JSON.stringify({
    mode: v.mode ?? "current", month: v.month ?? "", from: v.from ?? "", to: v.to ?? "", tower: Number(v.tower) || 0,
  }));
}

export type Period = {
  from: Date; to: Date;
  label: string;
  /** انقضى شهرُ الفترة وما زالت الشاشةُ عليه ⇒ يظهر زرُّ «شهر جديد» موسوماً */
  ended: boolean;
  /** الفترةُ التالية تتراكم في الخلفية — تظهر عند ضغط «شهر جديد» */
  nextFrom: Date | null;
  epoch: Date;
};

/**
 * الفترةُ الجارية. وقواعدُها بنصّ محمد:
 *   · تبدأ من لحظة التأسيس (لا شيءَ قبلها أبداً).
 *   · انقضى الشهرُ ولم يُضغَط «شهر جديد» ⇒ تبقى الشاشةُ على القديم **والجديدُ يتراكم**.
 *   · مضى **شهرٌ ثانٍ كاملٌ** بلا ضغط ⇒ تنتقل وحدَها فتظهر الأرقامُ الجديدة.
 */
export async function getPeriod(agentId: number, now = new Date()): Promise<Period> {
  let epochTxt = await readSetting(EPOCH_KEY(agentId));
  if (!epochTxt) { epochTxt = now.toISOString(); await writeSetting(EPOCH_KEY(agentId), epochTxt); }
  const epoch = new Date(epochTxt);

  let fromTxt = await readSetting(PERIOD_KEY(agentId));
  if (!fromTxt) { fromTxt = epoch.toISOString(); await writeSetting(PERIOD_KEY(agentId), fromTxt); }
  let from = new Date(fromTxt);
  if (from < epoch) from = epoch;

  const f = bg(from), n = bg(now);
  const monthsPassed = (n.y - f.y) * 12 + (n.m - f.m);
  // 🔁 شهران كاملان بلا ضغط ⇒ انتقالٌ تلقائيٌّ إلى الشهر الجاري (نصُّ محمد)
  if (monthsPassed >= 2) {
    from = bgStart(n.y, n.m, 1);
    if (from < epoch) from = epoch;
    await writeSetting(PERIOD_KEY(agentId), from.toISOString());
  }
  const ff = bg(from);
  const to = bgMonthEnd(ff.y, ff.m);
  const ended = now > to;
  return {
    from, to, label: monthLabel(from), ended,
    nextFrom: ended ? bgStart(n.y, n.m, 1) : null,
    epoch,
  };
}

/** «شهر جديد» — تُطوى الفترةُ الحاليّة وتبدأ من أوّل الشهر الجاري (أو من الآن إن كان في وسطه) */
export async function startNewMonth(agentId: number, now = new Date()): Promise<Period> {
  const n = bg(now);
  const cur = await getPeriod(agentId, now);
  // انقضى الشهر ⇒ نبدأ من أوّل الشهر الجاري (فتظهر الأرقامُ المتراكمة كاملةً)
  // ولم ينقضِ ⇒ نبدأ من **الآن** (تصفيرٌ صريحٌ بطلب الوكيل)
  const from = cur.ended ? bgStart(n.y, n.m, 1) : now;
  await writeSetting(PERIOD_KEY(agentId), from.toISOString());
  return getPeriod(agentId, now);
}

/** تحذيرُ المدى: «من ١» يوجب «إلى» آخرَ يومٍ في ذلك الشهر فعليّاً */
export function rangeWarning(from: Date, to: Date): string | null {
  const f = bg(from), t = bg(to);
  if (f.day !== 1) return null;
  const last = daysInMonth(f.y, f.m);
  if (f.y === t.y && f.m === t.m && t.day === last) return null;
  // النهايةُ آخرُ لحظةٍ في يومها (23:59:59.999) ⇒ التقريبُ وحدَه يعطي العددَ الصحيح
  const days = Math.round((to.getTime() - from.getTime()) / DAY);
  return days < last
    ? `⚠️ المدّةُ ${days} يوماً — **أقلُّ من الشهر** (شهرُ ${f.m + 1} فيه ${last} يوماً)`
    : `⚠️ المدّةُ ${days} يوماً — **أكثرُ من الشهر** (شهرُ ${f.m + 1} فيه ${last} يوماً)`;
}

// ───────────────────────── الحساب ─────────────────────────

export type DetailRow = {
  netUser: string | null; name: string | null; towerId: number; cabinet: number;
  packageName: string | null; months: number; at: Date | null;
  profit: number; deduct: number; estimated?: boolean;
};
export type Box = { count: number; months: number; profit: number; deduct: number; rows: DetailRow[] };
export type ProfitReport = {
  from: string; to: string; label: string; ended: boolean; epoch: string;
  warning: string | null;
  dormant: boolean;
  boxes: { actIn: Box; actExt: Box; instIn: Box; instExt: Box };
  net: number;
  /** ب · إنجازُ الداخليّ بحسب المستخدم — المنفصلون حصراً (قاعدة محمد 2026-08-26)؛ غيابُه = لا مفصولين */
  byUser?: { userId: number; name: string; towerId: number | null; actCount: number; actMonths: number; instCount: number }[];
};

const emptyBox = (): Box => ({ count: 0, months: 0, profit: 0, deduct: 0, rows: [] });

/**
 * يحسب الفترةَ كاملةً من مصادرَ قائمة. **لا يكتب شيئاً**.
 * ①/② التفعيلات: الفيصلُ **وجودُ وصلٍ في البرنامج** (±٣ أيّام) لا مكانُ التفعيل — نصُّ محمد:
 *    «ما دام له وصلٌ بمبلغٍ مستلمٍ أو ديناً فهو تفعيلٌ داخل المكتب وليس خارجيّاً».
 * ③/④ التنصيبات: باقتُه في الساس **عرض**، ويُحسَب **١ مرّةً واحدة**، والوصلُ خلال ٧ أيّام.
 */
export async function computeProfits(
  agentId: number, towerIds: number[], from: Date, to: Date,
): Promise<ProfitReport> {
  const { rules, dormant } = await loadRules(agentId);
  const period = { from, to };
  const out: ProfitReport = {
    from: from.toISOString(), to: to.toISOString(), label: monthLabel(from), ended: false,
    epoch: from.toISOString(), warning: rangeWarning(from, to), dormant,
    boxes: { actIn: emptyBox(), actExt: emptyBox(), instIn: emptyBox(), instExt: emptyBox() },
    net: 0,
  };
  if (!towerIds.length) return out;

  // الباقات: الاسمُ ⇒ المعرّف والسعر (سعرُ **البيع** المسجَّل — لا كلفةُ الكارت)
  const packages = await prisma.package.findMany({
    where: { agentId, isDeleted: false },
    select: { id: true, name: true, priceDinar: true },
  });
  const pkgById = new Map(packages.map((p) => [p.id, p]));
  const pkgByName = new Map(packages.map((p) => [(p.name ?? "").trim().toLowerCase(), p]));
  const priceOf = (id: number | null) => Math.round(Number((id != null ? pkgById.get(id)?.priceDinar : 0) ?? 0));

  // مشتركو المكاتب — لليوزر والكابينة والباقة
  const subs = await prisma.subscriber.findMany({
    where: { towerId: { in: towerIds }, isDeleted: false },
    select: { id: true, name: true, netUser: true, towerId: true, packageId: true, sasId: true },
  });
  const subById = new Map(subs.map((s) => [s.id, s]));
  const subBySas = new Map(subs.filter((s) => s.sasId != null).map((s) => [`${s.towerId}|${s.sasId}`, s]));

  // ═══ ب · المستخدمون المنفصلون — للإسناد «مَن أنجز الداخليّ؟» (طلبُ محمد 2026-08-26) ═══
  // بمنطقه هو: «الداخليُّ له وصلٌ في البرنامج، والوصلُ مختومٌ بقابضه — والخارجيُّ ترصده
  // المزامنةُ بلا يدِ أحدٍ فلا يُنسَب لمستخدمٍ أصلاً». والقائمةُ **المنفصلون حصراً**
  // (`separateAccount`) بقاعدته: غيرُ المفصولين لا يظهر لهم أيُّ تفصيلٍ — المكتبُ فقط.
  // 🔴 والفصلُ حكمٌ على **المكتب** (بلاغا محمد 2026-08-26 — حالةُ كاسبر): مؤشَّرٌ واحدٌ
  //    في مكتبٍ فيه مستخدمان+ يفصل المكتبَ كلَّه، فيُنسَب عملُ **كلِّ** مستخدميه —
  //    وإلّا غاب الأوّلُ (الذي لا يُعرَض عليه المربّعُ عند إنشائه) عن القسم وهو أكثرُهم عملاً.
  const allOfficeUsers = await prisma.user.findMany({
    where: { agentId, towerId: { in: towerIds }, isDeleted: false, isActive: true, isOwner: false },
    select: { id: true, fullName: true, username: true, towerId: true, separateAccount: true },
  });
  const sepTowerSet = new Set(allOfficeUsers.filter((u) => u.separateAccount).map((u) => u.towerId));
  const perTowerCount = new Map<number | null, number>();
  for (const u of allOfficeUsers) perTowerCount.set(u.towerId, (perTowerCount.get(u.towerId) ?? 0) + 1);
  const sepUsers = allOfficeUsers.filter((u) => sepTowerSet.has(u.towerId) && (perTowerCount.get(u.towerId) ?? 0) >= 2);
  const sepById = new Map(sepUsers.map((u) => [u.id, u]));
  const byUserAcc = new Map<number, { actCount: number; actMonths: number; instCount: number }>();
  const bump = (uid: number | null | undefined, f: "act" | "inst", months = 1) => {
    if (uid == null || !sepById.has(uid)) return;
    const a = byUserAcc.get(uid) ?? { actCount: 0, actMonths: 0, instCount: 0 };
    if (f === "act") { a.actCount++; a.actMonths += months; } else a.instCount++;
    byUserAcc.set(uid, a);
  };

  // ═══ ① التفعيلاتُ التي لها وصلٌ في البرنامج ═══
  const entries = await prisma.subscriptionEntry.findMany({
    where: { subscriberId: { in: subs.map((s) => s.id) }, isDeleted: false, date: { gte: from, lte: to } },
    select: { id: true, subscriberId: true, date: true, month: true, cardType: true, userId: true },
    orderBy: { id: "asc" },
  });
  /** تواريخُ وصولات كلّ مشترك — تُستعمل للفصل بين «داخليّ» و«خارجيّ» */
  const receiptsBySub = new Map<number, number[]>();
  for (const e of entries) {
    if (e.subscriberId == null || !e.date) continue;
    const l = receiptsBySub.get(e.subscriberId) ?? []; l.push(e.date.getTime()); receiptsBySub.set(e.subscriberId, l);
  }
  // ووصولاتٌ خارج المدى بقليل (٧ أيّام) تُحسب في اختبار «له وصل» لا في العدّ
  const near = await prisma.subscriptionEntry.findMany({
    where: {
      subscriberId: { in: subs.map((s) => s.id) }, isDeleted: false,
      date: { gte: new Date(from.getTime() - INSTALL_RECEIPT_MS), lte: new Date(to.getTime() + INSTALL_RECEIPT_MS) },
    },
    select: { subscriberId: true, date: true, userId: true },
  });
  // ب · الوقتُ **وختمُ قابضه معاً** — فوصلُ التنصيب هو دليلُ «داخليّ» وهو نفسُه دليلُ «مَن»
  const allReceipts = new Map<number, { t: number; userId: number | null }[]>();
  for (const e of near) {
    if (e.subscriberId == null || !e.date) continue;
    const l = allReceipts.get(e.subscriberId) ?? []; l.push({ t: e.date.getTime(), userId: e.userId ?? null }); allReceipts.set(e.subscriberId, l);
  }
  const hasReceiptAround = (subId: number, at: Date, span: number) =>
    (allReceipts.get(subId) ?? []).some((r) => Math.abs(r.t - at.getTime()) <= span);
  const hasReceiptAfter = (subId: number, at: Date, span: number) =>
    (allReceipts.get(subId) ?? []).some((r) => r.t >= at.getTime() - DAY && r.t <= at.getTime() + span);
  /** قابضُ أقرب وصلٍ في نافذة التنصيب — به يُنسَب التنصيبُ الداخليُّ لمن استلم ماله */
  const receiptUserAfter = (subId: number, at: Date, span: number): number | null => {
    const inWin = (allReceipts.get(subId) ?? []).filter((r) => r.t >= at.getTime() - DAY && r.t <= at.getTime() + span);
    if (!inWin.length) return null;
    inWin.sort((a, b) => Math.abs(a.t - at.getTime()) - Math.abs(b.t - at.getTime()));
    return inWin[0].userId;
  };

  for (const e of entries) {
    const s = e.subscriberId != null ? subById.get(e.subscriberId) : null;
    if (!s) continue;
    const months = Math.max(1, Number(e.month) || 1);
    const pkg = pkgByName.get((e.cardType ?? "").trim().toLowerCase()) ?? (s.packageId != null ? pkgById.get(s.packageId) : undefined);
    const cabinet = cabinetOfUser(s.netUser);
    const per = rules.actPerMonth(s.towerId ?? 0, cabinet, pkg?.id ?? 0, priceOf(pkg?.id ?? null));
    const profit = per * months;
    const box = out.boxes.actIn;
    box.count++; box.months += months; box.profit += profit;
    bump(e.userId, "act", months); // ب · الوصلُ مختومٌ بقابضه — نفسُ الصفّ الذي جعل التفعيلَ داخليّاً
    box.rows.push({
      netUser: s.netUser, name: s.name, towerId: s.towerId ?? 0, cabinet,
      packageName: pkg?.name ?? e.cardType ?? null, months, at: e.date, profit, deduct: 0,
    });
  }

  // ═══ ②③④ من سجلّ المزامنة ═══
  try {
    const logs = await prisma.syncLog.findMany({
      where: {
        towerId: { in: towerIds },
        kind: { in: ["self", "sas", "install"] },
        OR: [
          { activatedAt: { gte: from, lte: to } },
          { activatedAt: null, createdAt: { gte: from, lte: to } },
        ],
      },
      orderBy: { id: "asc" },
      select: {
        id: true, kind: true, towerId: true, sasId: true, subscriberId: true, netUser: true, name: true,
        packageName: true, amount: true, activatedAt: true, createdAt: true,
        sasDateTo: true, oldSasDateTo: true, note: true,
      },
    });
    const installSeen = new Set<string>(); // «مرّةً واحدة» لكلّ مشترك
    for (const r of logs) {
      const at = r.activatedAt ?? r.createdAt;
      const sub = r.subscriberId != null ? subById.get(r.subscriberId) : (r.sasId != null ? subBySas.get(`${r.towerId}|${r.sasId}`) : undefined);
      const netUser = r.netUser ?? sub?.netUser ?? null;
      const cabinet = cabinetOfUser(netUser);
      const pkg = pkgByName.get((r.packageName ?? "").trim().toLowerCase()) ?? (sub?.packageId != null ? pkgById.get(sub.packageId) : undefined);
      const offer = isOfferPackage(r.packageName);
      const isLoan = Math.round(r.amount ?? 0) <= 0 && !offer;

      if (offer) {
        // ③④ تنصيبٌ (أو إعادةُ خدمة) — مرّةً واحدةً لكلّ مشترك
        const key = `${r.towerId}|${r.sasId ?? r.subscriberId ?? r.id}`;
        if (installSeen.has(key)) continue;
        installSeen.add(key);
        const inside = sub ? hasReceiptAfter(sub.id, at, INSTALL_RECEIPT_MS) : false;
        const profit = rules.installProfit(r.towerId, cabinet, pkg?.id ?? 0, !inside);
        const deduct = rules.deduction(r.towerId, cabinet, pkg?.id ?? 0, !inside);
        const box = inside ? out.boxes.instIn : out.boxes.instExt;
        box.count++; box.months += 1; box.profit += profit; box.deduct += deduct;
        if (inside && sub) bump(receiptUserAfter(sub.id, at, INSTALL_RECEIPT_MS), "inst"); // ب
        box.rows.push({
          netUser, name: r.name ?? sub?.name ?? null, towerId: r.towerId, cabinet,
          packageName: r.packageName, months: 1, at, profit, deduct,
        });
        continue;
      }
      if (isLoan) continue; // 💸 قرضُ سوبر سيل ليس تفعيلاً ولا ربحاً
      // ② تفعيلٌ خارجيّ — إلّا إن كان له وصلٌ عندنا فيصير داخليّاً (وقد عُدّ أعلاه)
      if (sub && hasReceiptAround(sub.id, at, ACT_RECEIPT_MS)) continue;
      let months = 1; let estimated = true;
      if (r.sasDateTo && r.oldSasDateTo) {
        months = Math.max(1, Math.round((r.sasDateTo.getTime() - r.oldSasDateTo.getTime()) / (30 * DAY)));
        estimated = false;
      }
      const per = rules.actPerMonth(r.towerId, cabinet, pkg?.id ?? 0, priceOf(pkg?.id ?? null));
      const profit = per * months;
      const box = out.boxes.actExt;
      box.count++; box.months += months; box.profit += profit;
      box.rows.push({
        netUser, name: r.name ?? sub?.name ?? null, towerId: r.towerId, cabinet,
        packageName: r.packageName, months, at, profit, deduct: 0, estimated,
      });
    }
  } catch (e) {
    if (!tableMissing(e)) throw e; // جدولُ سجلّ المزامنة غائبٌ ⇒ المربّعاتُ الثلاثةُ أصفار
  }

  const B = out.boxes;
  out.net = B.actIn.profit + B.actExt.profit + B.instIn.profit + B.instExt.profit
    - (B.instIn.deduct + B.instExt.deduct);
  // التفاصيلُ تُقصَّ للعرض (الأحدثُ أوّلاً) — والعدّادُ يبقى كاملاً
  for (const k of ["actIn", "actExt", "instIn", "instExt"] as const) {
    B[k].rows.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    B[k].rows = B[k].rows.slice(0, 300);
  }
  // ب · التفصيلُ بالمستخدم — يُبنى فقط إن وُجد مفصولون أنجزوا شيئاً، فغيابُه صفرُ تغييرٍ في العرض
  if (byUserAcc.size) {
    out.byUser = [...byUserAcc.entries()].map(([id, a]) => {
      const u = sepById.get(id)!;
      return { userId: id, name: u.fullName || u.username, towerId: u.towerId, ...a };
    }).sort((x, y) => (y.actCount + y.instCount) - (x.actCount + x.instCount));
  }
  void period;
  return out;
}
