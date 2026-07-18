import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { statementForTechnician } from "@/lib/salary";

export const dynamic = "force-dynamic";

// حسابات المدير (موحّدة عامة): المبلغ الكلي، ديون الكارتات، مصروفات/مقبوضات المدير، وسحوبات الموظفين
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  // فترة احتساب الرواتب العامة للوكيل (إن ضُبطت) — يُحسب الصافي ضمنها فقط
  const agent = g.session.agentId != null ? await prisma.agent.findUnique({ where: { id: g.session.agentId }, select: { salaryPeriodFrom: true, salaryPeriodTo: true } }) : null;
  const period = agent?.salaryPeriodFrom && agent?.salaryPeriodTo ? { from: agent.salaryPeriodFrom, to: agent.salaryPeriodTo } : null;

  const [dailyAgg, cardsAgg, mgr, employeeAccounts, mgrTxs, masterAgg] = await Promise.all([
    // مجموع المبالغ اليومية = صافي كل حركات التقرير اليومي عبر كل الأيام (باستثناء الماستر)
    prisma.moneyTx.aggregate({ where: { isDeleted: false, OR: [{ sourceType: null }, { sourceType: { not: "master" } }] }, _sum: { moneyIn: true, moneyOut: true } }),
    // مجموع مبالغ الكروت المضافة (كلفة الشراء) = ديون الكارتات قبل التسديد
    prisma.rechargeCard.aggregate({ where: {}, _sum: { price: true } }),
    // حركات المدير مجمّعة حسب النوع
    prisma.managerTx.groupBy({ by: ["type"], where: { isDeleted: false }, _sum: { amount: true } }),
    // حسابات الموظفين (للعرض فقط: كم سحب كل موظف من التقرير اليومي)
    prisma.account.findMany({ where: { isDeleted: false, isEmployee: true }, select: { id: true, name: true } }),
    // سجل حركات المدير
    prisma.managerTx.findMany({ where: { isDeleted: false }, orderBy: { id: "desc" }, take: 200 }),
    // حساب الماستر — مستقل تماماً (تفعيلات ماستر + قبض/صرف ماستر)
    prisma.moneyTx.aggregate({ where: { isDeleted: false, sourceType: "master" }, _sum: { moneyIn: true, moneyOut: true } }),
  ]);
  const masterBalance = (masterAgg._sum.moneyIn ?? 0) - (masterAgg._sum.moneyOut ?? 0);

  const cumulativeDaily = (dailyAgg._sum.moneyIn ?? 0) - (dailyAgg._sum.moneyOut ?? 0);
  const cardDebtAdded = cardsAgg._sum.price ?? 0;
  const sumBy = (t: string) => mgr.find((m) => m.type === t)?._sum.amount ?? 0;
  const cardPayments = sumBy("card-payment");
  const managerExpenses = sumBy("expense");
  const managerReceipts = sumBy("receipt");

  const cardDebtRemaining = cardDebtAdded - cardPayments;
  const totalAvailable = cumulativeDaily - cardPayments - managerExpenses + managerReceipts;

  // الموظفون (الفنيون): الراتب المتبقي (صافي كشف الراتب) + ما سحبه للعرض
  const employees: { id: number; name: string | null; withdrawn: number; technicianId: number | null; net: number | null }[] = [];
  for (const acc of employeeAccounts) {
    const a = await prisma.moneyTx.aggregate({ where: { isDeleted: false, accountId: acc.id }, _sum: { moneyOut: true } });
    const tech = await prisma.technician.findFirst({ where: { accountId: acc.id, isDeleted: false }, select: { id: true, name: true, salary: true } });
    let net: number | null = null;
    if (tech) net = (await statementForTechnician(tech.id, tech.salary ?? 0, period)).net;
    employees.push({ id: acc.id, name: tech?.name ?? acc.name, withdrawn: a._sum.moneyOut ?? 0, technicianId: tech?.id ?? null, net });
  }

  return NextResponse.json({
    cumulativeDaily,
    totalAvailable,
    cardDebtAdded,
    cardPayments,
    cardDebtRemaining,
    managerExpenses,
    managerReceipts,
    masterBalance,
    employees,
    transactions: mgrTxs,
    salaryPeriod: period,
  });
}
