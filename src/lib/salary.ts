// حساب راتب الفني — كل الأوقات بتوقيت بغداد (تُشتق dayKey من سجل الحضور/الإجازة).
// النموذج: مبلغ اليوم = الراتب ÷ أيام الشهر، يُضاف عند الحضور (بصمة) أو الإجازة براتب.
// الصافي = مبالغ الأيام + الإضافي + المكافآت المؤكّدة − خصومات الحضور − الخصومات المؤكّدة.

export type SalaryAttendance = {
  dayKey: string | null; checkIn: Date | null;
  lateDeduction: number | null; earlyDeduction: number | null; overtimeAddition: number | null;
};
export type SalaryLeave = { dayKey: string; kind: string; paid: boolean; status: string; reason: string };
export type SalaryAdjustment = { dayKey: string; kind: string; amount: number; status: string; reason: string };

export type SalaryItem = { date: string; type: string; label: string; amount: number; reason?: string };
export type SalaryResult = {
  daysPaid: number; cleanDays: number; dailyAmount: number;
  baseEarned: number; overtime: number; bonuses: number;
  attendanceDeductions: number; confirmedDeductions: number; net: number;
  periodFrom: string; periodTo: string; items: SalaryItem[];
};

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

export function computeSalary(
  salary: number,
  attendances: SalaryAttendance[],
  leaves: SalaryLeave[],
  adjustments: SalaryAdjustment[],
  todayKey: string,
): SalaryResult {
  const items: SalaryItem[] = [];
  let baseEarned = 0, overtime = 0, bonuses = 0, attDed = 0, confDed = 0;
  let daysPaid = 0, cleanDays = 0;
  const keys: string[] = [];

  for (const a of attendances) {
    if (!a.checkIn || !a.dayKey) continue;
    keys.push(a.dayKey);
    const dm = dailyAmountFor(salary, a.dayKey);
    baseEarned += dm; daysPaid++;
    const late = a.lateDeduction ?? 0, early = a.earlyDeduction ?? 0, ot = a.overtimeAddition ?? 0;
    attDed += late + early; overtime += ot;
    if (late) items.push({ date: a.dayKey, type: "late", label: "خصم تأخير", amount: -late });
    if (early) items.push({ date: a.dayKey, type: "early", label: "خصم خروج مبكّر", amount: -early });
    if (ot) items.push({ date: a.dayKey, type: "overtime", label: "إضافي", amount: ot });
    if (!late && !early && !ot) cleanDays++; // بصمة سليمة — لا تُدرَج بالتفاصيل
  }

  for (const l of leaves) {
    if (l.status !== "approved") continue;
    keys.push(l.dayKey);
    if (l.kind === "day" && l.paid) {
      const dm = dailyAmountFor(salary, l.dayKey);
      baseEarned += dm; daysPaid++;
      items.push({ date: l.dayKey, type: "leave-paid", label: "إجازة براتب", amount: dm, reason: l.reason });
    } else if (l.kind === "day") {
      items.push({ date: l.dayKey, type: "leave-unpaid", label: "إجازة بلا راتب", amount: 0, reason: l.reason });
    } else {
      items.push({ date: l.dayKey, type: "leave-time", label: "إجازة زمنية", amount: 0, reason: l.reason });
    }
  }

  for (const adj of adjustments) {
    if (adj.status !== "confirmed") continue;
    keys.push(adj.dayKey);
    if (adj.kind === "bonus") { bonuses += adj.amount; items.push({ date: adj.dayKey, type: "bonus", label: "مكافأة", amount: adj.amount, reason: adj.reason }); }
    else { confDed += adj.amount; items.push({ date: adj.dayKey, type: "deduction", label: "خصم", amount: -adj.amount, reason: adj.reason }); }
  }

  const net = baseEarned + overtime + bonuses - attDed - confDed;
  const sorted = keys.filter(Boolean).sort();
  const dailyAmount = daysPaid > 0 ? Math.round(baseEarned / daysPaid) : dailyAmountFor(salary, todayKey);
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    daysPaid, cleanDays, dailyAmount,
    baseEarned, overtime, bonuses, attendanceDeductions: attDed, confirmedDeductions: confDed, net,
    periodFrom: sorted[0] ?? todayKey, periodTo: todayKey, items,
  };
}
