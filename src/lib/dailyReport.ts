import "server-only";
import { prisma } from "@/lib/prisma";

// حدود يوم العراق (UTC+3)
export function iraqTodayRange(now = new Date()): { start: Date; end: Date } {
  const iraq = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = iraq.getUTCFullYear();
  const m = iraq.getUTCMonth();
  const d = iraq.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0) - 3 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - 3 * 60 * 60 * 1000);
  return { start, end };
}

// حدود "أمس" بتوقيت العراق (UTC+3) — لمرحلة مزامنة كروت وتفعيلات اليوم السابق
export function iraqYesterdayRange(now = new Date()): { start: Date; end: Date } {
  return iraqTodayRange(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");

// يحسب أرقام التقرير اليومي (اختيارياً مقيّداً بمكتب، وليوم محدّد للتدارك)
export async function computeDailyReport(towerId?: number | null, day?: Date) {
  const { start, end } = iraqTodayRange(day ?? new Date());
  const dateWhere = { date: { gte: start, lte: end } };
  const towerWhere = towerId ? { towerId } : {};

  const [activations, todayMoney, todayInvoices, todaySales] = await Promise.all([
    prisma.subscriptionEntry.aggregate({
      where: { isDeleted: false, ...dateWhere, ...towerWhere },
      _count: true,
      _sum: { moneyIn: true },
    }),
    prisma.moneyTx.aggregate({
      where: { isDeleted: false, ...dateWhere, ...towerWhere },
      _sum: { moneyIn: true, moneyOut: true },
    }),
    prisma.invoice.aggregate({
      where: { isDeleted: false, ...dateWhere, ...towerWhere },
      _count: true,
      _sum: { waselHim: true },
    }),
    // مبيعات المخزن (البيع المباشر + مواد الذمم) — حركات سطرها sourceType="sale"
    prisma.moneyTx.aggregate({
      where: { isDeleted: false, sourceType: "sale", ...dateWhere, ...towerWhere },
      _sum: { moneyIn: true },
    }),
  ]);

  const todayIn = todayMoney._sum.moneyIn ?? 0;
  const todayOut = todayMoney._sum.moneyOut ?? 0;
  const activationIn = activations._sum.moneyIn ?? 0;
  const invoiceIn = todayInvoices._sum.waselHim ?? 0;
  const salesIn = todaySales._sum.moneyIn ?? 0;
  const otherIn = Math.max(0, todayIn - activationIn - invoiceIn - salesIn);
  const total = todayIn - todayOut;

  return {
    activationCount: activations._count || 0,
    activationIn,
    invoiceCount: todayInvoices._count || 0,
    invoiceIn,
    salesIn,
    otherIn,
    expenses: todayOut,
    total,
  };
}

// نص التقرير اليومي لإرساله للمدير عبر واتساب (اختيارياً ليوم محدّد للتدارك)
export async function dailyReportText(office: string, towerId?: number | null, forDay?: Date): Promise<string> {
  const r = await computeDailyReport(towerId, forDay);
  // تاريخ اليوم بتوقيت بغداد (UTC+3) بنفس منطق حدود اليوم — لتفادي اختلاف المنطقة الزمنية المحلية
  const iraq = new Date((forDay ?? new Date()).getTime() + 3 * 60 * 60 * 1000);
  const day = `${String(iraq.getUTCDate()).padStart(2, "0")}/${String(iraq.getUTCMonth() + 1).padStart(2, "0")}/${iraq.getUTCFullYear()}`;
  return (
    `📊 التقرير اليومي — ${office}\n` +
    `التاريخ: ${day}\n` +
    `——————————————\n` +
    `تفعيل اشتراكات: ${r.activationCount} — ${fmt(r.activationIn)} د.ع\n` +
    `فاتورة المبيع: ${r.invoiceCount} — ${fmt(r.invoiceIn)} د.ع\n` +
    `مبيعات المخزن: ${fmt(r.salesIn)} د.ع\n` +
    `المقبوضات الأخرى: ${fmt(r.otherIn)} د.ع\n` +
    `المصروفات: ${fmt(r.expenses)} د.ع\n` +
    `——————————————\n` +
    `💰 المجموع: ${fmt(r.total)} د.ع`
  );
}
