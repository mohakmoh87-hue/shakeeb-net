// حساب راتب الفني — كل الأوقات بتوقيت بغداد (تُشتق dayKey من سجل الحضور/الإجازة).
// النموذج: مبلغ اليوم = الراتب ÷ أيام الشهر، يُضاف عند الحضور (بصمة) أو الإجازة براتب.
// الفترة: يحدّدها المدير (من/إلى شامل) — كل الاحتساب (الأيام، الخصومات، المكافآت، وسحب/إضافة حساب الموظف) ضمنها فقط.
// الصافي = مبالغ الأيام + الإضافي + المكافآت + إضافات الحساب (قبض) − خصومات الحضور − الخصومات المؤكّدة − سحوبات الحساب (صرف).

export type SalaryAttendance = {
  dayKey: string | null; checkIn: Date | null;
  lateDeduction: number | null; earlyDeduction: number | null; overtimeAddition: number | null;
  lateExcuse?: string | null; // pending/approved ⇒ خصم التأخير مُعلَّق (لا يُحتسب)
};
export type SalaryLeave = { dayKey: string; kind: string; paid: boolean; status: string; reason: string };
export type SalaryAdjustment = { dayKey: string; kind: string; amount: number; status: string; reason: string };
export type SalaryMoneyTx = { dayKey: string; moneyIn: number; moneyOut: number; notes: string };
export type SalaryPeriod = { from: string; to: string };

export type SalaryItem = { date: string; type: string; label: string; amount: number; reason?: string };
export type SalaryDay = { date: string; amount: number; note: string }; // تفصيل مبالغ الأيام
export type SalaryResult = {
  daysPaid: number; cleanDays: number; dailyAmount: number;
  baseEarned: number; overtime: number; bonuses: number; credits: number;
  attendanceDeductions: number; confirmedDeductions: number; advances: number; net: number;
  periodFrom: string; periodTo: string; items: SalaryItem[]; dayDetails: SalaryDay[];
};

// كشف راتب فنيٍّ من قاعدة البيانات (مشترك بين مسار الراتب وحسابات المدير)
import { prisma } from "./prisma";
import { baghdadDayKey } from "./attendance";

// أقدم سجلّ غير مُسدَّد يؤثّر على راتب الفني (مفتاح يوم بغداد) — لتثبيت الفترة المجمّدة.
// (السجلات المُسدَّدة تُحذَف/تُعلَّم عند التسديد، فالمتبقّي هو غير المُسدَّد.)
async function earliestUnsettledKey(technicianId: number, accountId: number | null): Promise<string | null> {
  const [att, lv, adj, mt] = await Promise.all([
    prisma.attendance.findFirst({ where: { technicianId }, orderBy: { dayKey: "asc" }, select: { dayKey: true } }),
    prisma.leave.findFirst({ where: { technicianId, status: "approved" }, orderBy: { dayKey: "asc" }, select: { dayKey: true } }),
    prisma.adjustment.findFirst({ where: { technicianId, status: "confirmed" }, orderBy: { dayKey: "asc" }, select: { dayKey: true } }),
    accountId
      ? prisma.moneyTx.findFirst({ where: { accountId, isDeleted: false, salaryStatementId: null }, orderBy: { date: "asc" }, select: { date: true } })
      : Promise.resolve(null),
  ]);
  const keys: string[] = [];
  if (att?.dayKey) keys.push(att.dayKey);
  if (lv?.dayKey) keys.push(lv.dayKey);
  if (adj?.dayKey) keys.push(adj.dayKey);
  if (mt?.date) keys.push(baghdadDayKey(mt.date));
  return keys.length ? keys.sort()[0] : null;
}

// أحدث فترة «مكتملة» (انقضى يوم نهايتها) بالنسبة لليوم — تنتهي عند آخر «يوم نهاية» ≤ اليوم.
// تُستعمل للتجميد: عند التأخّر يُسدَّد الفني حتى يوم النهاية الأخير المنقضي بالضبط.
function lastCompletedPeriod(
  fromDay: number | null | undefined,
  toDay: number | null | undefined,
  todayKey: string,
): SalaryPeriod | null {
  if (!fromDay || !toDay) return null;
  const [ty, tm, td] = todayKey.split("-").map(Number);
  // شهر النهاية = هذا الشهر إن بلغنا يوم النهاية، وإلا الشهر السابق
  let ey = ty, em = tm;
  if (td < clampDay(ty, tm, toDay)) { em = tm - 1; if (em < 1) { em = 12; ey = ty - 1; } }
  const endDay = clampDay(ey, em, toDay);
  let sy = ey, sm = em - 1; if (sm < 1) { sm = 12; sy = ey - 1; }
  const startDay = clampDay(sy, sm, fromDay);
  return { from: `${sy}-${pad2(sm)}-${pad2(startDay)}`, to: `${ey}-${pad2(em)}-${pad2(endDay)}` };
}

// الفترة الحالية لفنيٍّ بعينه — «مجمّدة»: إن بقيت سجلات غير مُسدَّدة من فترة سابقة (أقدم من
// بداية الفترة المفتوحة)، نبقى على أحدث فترة مكتملة حتى يُسدّدها المدير (فلا تتدحرج ولا يضيع
// مبلغ) — ويُوسَّع مبدؤها ليشمل أقدم سجل إن كان أبكر. وإلا فالفترة المفتوحة الحالية.
// أي شيء بعد «إلى» (يوم النهاية) يُرحَّل للفترة التالية تلقائياً.
export async function periodForTechnician(
  technicianId: number,
  accountId: number | null,
  fromDay: number | null | undefined,
  toDay: number | null | undefined,
  todayKey: string,
): Promise<SalaryPeriod | null> {
  const open = currentPeriodFromDays(fromDay, toDay, todayKey);
  if (!open) return null;
  const earliest = await earliestUnsettledKey(technicianId, accountId);
  if (earliest && earliest < open.from) {
    const completed = lastCompletedPeriod(fromDay, toDay, todayKey) ?? open;
    // نضمّ أي متراكم أقدم من بداية الفترة المكتملة لتسويته دفعةً واحدة دون ضياع
    return { from: earliest < completed.from ? earliest : completed.from, to: completed.to };
  }
  return open;
}

export async function statementForTechnician(
  technicianId: number,
  salary: number,
  fromDay: number | null | undefined,
  toDay: number | null | undefined,
): Promise<SalaryResult> {
  const todayKey = baghdadDayKey(new Date());
  const tech = await prisma.technician.findUnique({ where: { id: technicianId }, select: { accountId: true } });
  const accountId = tech?.accountId ?? null;
  const p = await periodForTechnician(technicianId, accountId, fromDay, toDay, todayKey);
  const dayRange = p ? { gte: p.from, lte: p.to } : undefined; // dayKey ISO يقارن نصياً = زمنياً
  // حدود التاريخ لحركات حساب الموظف (بغداد UTC+3)
  const dateRange = p ? { gte: new Date(`${p.from}T00:00:00+03:00`), lte: new Date(`${p.to}T23:59:59.999+03:00`) } : undefined;

  const [att, leaves, adj, money] = await Promise.all([
    prisma.attendance.findMany({ where: { technicianId, ...(dayRange ? { dayKey: dayRange } : {}) }, select: { dayKey: true, checkIn: true, lateDeduction: true, earlyDeduction: true, overtimeAddition: true, lateExcuse: true } }),
    prisma.leave.findMany({ where: { technicianId, ...(dayRange ? { dayKey: dayRange } : {}) }, select: { dayKey: true, kind: true, paid: true, status: true, reason: true } }),
    prisma.adjustment.findMany({ where: { technicianId, ...(dayRange ? { dayKey: dayRange } : {}) }, select: { dayKey: true, kind: true, amount: true, status: true, reason: true } }),
    accountId
      ? prisma.moneyTx.findMany({ where: { accountId, isDeleted: false, salaryStatementId: null, ...(dateRange ? { date: dateRange } : {}) }, select: { date: true, moneyIn: true, moneyOut: true, notes: true } })
      : Promise.resolve([] as { date: Date | null; moneyIn: number | null; moneyOut: number | null; notes: string | null }[]),
  ]);

  const moneyItems: SalaryMoneyTx[] = money.map((m) => ({
    dayKey: baghdadDayKey(m.date ?? new Date()), moneyIn: m.moneyIn ?? 0, moneyOut: m.moneyOut ?? 0, notes: m.notes ?? "",
  }));

  return computeSalary(salary, att as SalaryAttendance[], leaves as SalaryLeave[], adj as SalaryAdjustment[], moneyItems, todayKey, p);
}

// أيام شهر الـ dayKey (YYYY-MM-DD)
export function daysInMonthOf(dayKey: string): number {
  const [y, m] = dayKey.split("-").map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}
export function dailyAmountFor(salary: number, dayKey: string): number {
  const d = daysInMonthOf(dayKey);
  return d > 0 ? Math.round((salary || 0) / d) : 0;
}

// اليوم التالي لمفتاح يوم (YYYY-MM-DD) — لتقديم الفترة تلقائياً بعد التسديد
export function addDaysKey(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
// آخر يوم في شهر مفتاح اليوم
export function lastDayOfMonthKey(dayKey: string): string {
  const [y, m] = dayKey.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
// يقصّ اليوم إلى آخر يوم فعليّ في الشهر (m1 = 1-12) — مثلاً 31 في شباط ⇒ 28/29
function clampDay(y: number, m1: number, day: number): number {
  const last = new Date(Date.UTC(y, m1, 0)).getUTCDate();
  return Math.min(Math.max(1, day), last);
}

// الفترة الحالية من يومَي البداية/النهاية (متكرّرة شهرياً بلا شهر/سنة):
// تمتدّ من «يوم البداية» في شهرٍ إلى «يوم النهاية» في الشهر التالي (نحو ٣٠-٣١ يوماً).
// ترتبط بالوقت الحالي: النهاية = أقرب «يوم النهاية» ≥ اليوم؛ والبداية = «يوم البداية» من الشهر السابق لها.
export function currentPeriodFromDays(
  fromDay: number | null | undefined,
  toDay: number | null | undefined,
  todayKey: string,
): SalaryPeriod | null {
  if (!fromDay || !toDay) return null;
  const [ty, tm, td] = todayKey.split("-").map(Number);
  // شهر النهاية: هذا الشهر إن لم يتجاوز اليوم «يوم النهاية»، وإلا الشهر التالي
  let ey = ty, em = tm;
  if (td > clampDay(ty, tm, toDay)) { em = tm + 1; if (em > 12) { em = 1; ey = ty + 1; } }
  const endDay = clampDay(ey, em, toDay);
  // شهر البداية = الشهر السابق لشهر النهاية
  let sy = ey, sm = em - 1; if (sm < 1) { sm = 12; sy = ey - 1; }
  const startDay = clampDay(sy, sm, fromDay);
  return { from: `${sy}-${pad2(sm)}-${pad2(startDay)}`, to: `${ey}-${pad2(em)}-${pad2(endDay)}` };
}

export function computeSalary(
  salary: number,
  attendances: SalaryAttendance[],
  leaves: SalaryLeave[],
  adjustments: SalaryAdjustment[],
  moneyTxs: SalaryMoneyTx[],
  todayKey: string,
  period?: SalaryPeriod | null,
): SalaryResult {
  const items: SalaryItem[] = [];
  const dayDetails: SalaryDay[] = [];
  let baseEarned = 0, overtime = 0, bonuses = 0, attDed = 0, confDed = 0, advances = 0, credits = 0;
  let daysPaid = 0, cleanDays = 0;
  const keys: string[] = [];
  // تصفية دفاعية بالفترة (بجانب تصفية القاعدة) لضمان «هذه الفترة فقط»
  const inPeriod = (k: string | null | undefined) => !period || (!!k && k >= period.from && k <= period.to);

  for (const a of attendances) {
    if (!a.checkIn || !a.dayKey || !inPeriod(a.dayKey)) continue;
    keys.push(a.dayKey);
    const dm = dailyAmountFor(salary, a.dayKey);
    baseEarned += dm; daysPaid++;
    // خصم التأخير مُعلَّق إن كان هناك طلب «نسيت البصمة» معلّق أو مقبول — لا يُحتسب
    const lateHeld = a.lateExcuse === "pending" || a.lateExcuse === "approved";
    const late = lateHeld ? 0 : (a.lateDeduction ?? 0), early = a.earlyDeduction ?? 0, ot = a.overtimeAddition ?? 0;
    attDed += late + early; overtime += ot;
    const notes: string[] = [];
    if (late) { items.push({ date: a.dayKey, type: "late", label: "خصم تأخير", amount: -late }); notes.push("تأخير"); }
    if (early) { items.push({ date: a.dayKey, type: "early", label: "خصم خروج مبكّر", amount: -early }); notes.push("خروج مبكّر"); }
    if (ot) { items.push({ date: a.dayKey, type: "overtime", label: "إضافي", amount: ot }); notes.push("إضافي"); }
    if (lateHeld) notes.push(a.lateExcuse === "approved" ? "عُذر مقبول" : "طلب نسيان بصمة معلّق");
    if (!late && !early && !ot && !lateHeld) cleanDays++; // بصمة سليمة
    dayDetails.push({ date: a.dayKey, amount: dm, note: notes.length ? notes.join("، ") : "بصمة سليمة" });
  }

  for (const l of leaves) {
    if (l.status !== "approved" || !inPeriod(l.dayKey)) continue;
    keys.push(l.dayKey);
    if (l.kind === "day" && l.paid) {
      const dm = dailyAmountFor(salary, l.dayKey);
      baseEarned += dm; daysPaid++;
      items.push({ date: l.dayKey, type: "leave-paid", label: "إجازة براتب", amount: dm, reason: l.reason });
      dayDetails.push({ date: l.dayKey, amount: dm, note: "إجازة براتب" });
    } else if (l.kind === "day") {
      items.push({ date: l.dayKey, type: "leave-unpaid", label: "إجازة بلا راتب", amount: 0, reason: l.reason });
    } else {
      items.push({ date: l.dayKey, type: "leave-time", label: "إجازة زمنية", amount: 0, reason: l.reason });
    }
  }

  for (const adj of adjustments) {
    if (adj.status !== "confirmed" || !inPeriod(adj.dayKey)) continue;
    keys.push(adj.dayKey);
    if (adj.kind === "bonus") { bonuses += adj.amount; items.push({ date: adj.dayKey, type: "bonus", label: "مكافأة", amount: adj.amount, reason: adj.reason }); }
    else { confDed += adj.amount; items.push({ date: adj.dayKey, type: "deduction", label: "خصم", amount: -adj.amount, reason: adj.reason }); }
  }

  // سحب/إضافة حساب الموظف (المصروفات والمقبوضات) — صرف يُخصم، قبض يُضاف
  for (const m of moneyTxs) {
    if (!inPeriod(m.dayKey)) continue;
    const out = m.moneyOut ?? 0, inn = m.moneyIn ?? 0;
    if (out) { advances += out; keys.push(m.dayKey); items.push({ date: m.dayKey, type: "advance", label: "سحب من الحساب", amount: -out, reason: m.notes || undefined }); }
    if (inn) { credits += inn; keys.push(m.dayKey); items.push({ date: m.dayKey, type: "credit", label: "إضافة للحساب", amount: inn, reason: m.notes || undefined }); }
  }

  const net = baseEarned + overtime + bonuses + credits - attDed - confDed - advances;
  const sorted = keys.filter(Boolean).sort();
  const dailyAmount = daysPaid > 0 ? Math.round(baseEarned / daysPaid) : dailyAmountFor(salary, todayKey);
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  dayDetails.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    daysPaid, cleanDays, dailyAmount,
    baseEarned, overtime, bonuses, credits, attendanceDeductions: attDed, confirmedDeductions: confDed, advances, net,
    periodFrom: period?.from ?? (sorted[0] ?? todayKey), periodTo: period?.to ?? todayKey, items, dayDetails,
  };
}
