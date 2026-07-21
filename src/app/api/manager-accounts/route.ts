import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { statementForTechnician, currentPeriodFromDays } from "@/lib/salary";
import { baghdadDayKey } from "@/lib/attendance";

export const dynamic = "force-dynamic";

// حسابات المدير (موحّدة على مستوى الوكيل): المبلغ الكلي، ديون الكارتات، مصروفات/مقبوضات المدير، وسحوبات الموظفين
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  // عزل المستأجر: كل الأرقام ضمن وكيل المستخدم فقط — أبراج الوكيل للحركات المرتبطة بالبرج، وagentId للباقي
  const agentId = g.session.agentId ?? -1;
  const towerIds = await agentTowerIds(g.session);
  const towerWhere = { towerId: { in: towerIds.length ? towerIds : [-1] } };

  // فترة احتساب الرواتب: يومان من الشهر تتكرّران — تُحسب فترة كل فنيٍّ (مجمّدة) داخل كشفه
  const agent = g.session.agentId != null ? await prisma.agent.findUnique({ where: { id: g.session.agentId }, select: { salaryFromDay: true, salaryToDay: true } }) : null;
  const cur = currentPeriodFromDays(agent?.salaryFromDay, agent?.salaryToDay, baghdadDayKey(new Date()));
  const salaryPeriodInfo = { fromDay: agent?.salaryFromDay ?? null, toDay: agent?.salaryToDay ?? null, from: cur?.from ?? null, to: cur?.to ?? null };

  const [dailyAgg, cardsAgg, mgr, employeeAccounts, mgrTxs, masterAgg] = await Promise.all([
    // مجموع المبالغ اليومية = صافي كل حركات التقرير اليومي عبر كل أيام مكاتب الوكيل (باستثناء الماستر)
    prisma.moneyTx.aggregate({ where: { isDeleted: false, ...towerWhere, OR: [{ sourceType: null }, { sourceType: { not: "master" } }] }, _sum: { moneyIn: true, moneyOut: true } }),
    // مجموع مبالغ الكروت المضافة (كلفة الشراء) = ديون الكارتات قبل التسديد — كروت الوكيل فقط
    prisma.rechargeCard.aggregate({ where: { agentId }, _sum: { price: true } }),
    // حركات المدير مجمّعة حسب النوع — للوكيل فقط
    prisma.managerTx.groupBy({ by: ["type"], where: { isDeleted: false, agentId }, _sum: { amount: true } }),
    // حسابات الموظفين (للعرض فقط: كم سحب كل موظف من التقرير اليومي) — ضمن مكاتب الوكيل
    prisma.account.findMany({ where: { isDeleted: false, isEmployee: true, ...towerWhere }, select: { id: true, name: true } }),
    // سجل حركات المدير — للوكيل فقط
    prisma.managerTx.findMany({ where: { isDeleted: false, agentId }, orderBy: { id: "desc" }, take: 200 }),
    // حساب الماستر — مستقل تماماً (تفعيلات ماستر + قبض/صرف ماستر) — ضمن مكاتب الوكيل
    prisma.moneyTx.aggregate({ where: { isDeleted: false, sourceType: "master", ...towerWhere }, _sum: { moneyIn: true, moneyOut: true } }),
  ]);
  const masterBalance = (masterAgg._sum.moneyIn ?? 0) - (masterAgg._sum.moneyOut ?? 0);

  const cumulativeDaily = (dailyAgg._sum.moneyIn ?? 0) - (dailyAgg._sum.moneyOut ?? 0);
  const sumBy = (t: string) => mgr.find((m) => m.type === t)?._sum.amount ?? 0;
  // ديون الكارتات = كلفة الكروت المضافة + الإضافات اليدوية − الإنقاصات اليدوية
  const cardDebtAdded = (cardsAgg._sum.price ?? 0) + sumBy("card-debt-add") - sumBy("card-debt-sub");
  const cardPayments = sumBy("card-payment");
  const managerExpenses = sumBy("expense");
  const managerReceipts = sumBy("receipt");
  const salaryFromTotal = sumBy("salary"); // رواتب سُدِّدت «من المبلغ الكلي» (خارج التقرير اليومي)

  const cardDebtRemaining = cardDebtAdded - cardPayments;
  const totalAvailable = cumulativeDaily - cardPayments - managerExpenses - salaryFromTotal + managerReceipts;

  // الموظفون (الفنيون): الراتب المتبقي (صافي كشف الراتب) + ما سحبه للعرض
  const employees: { id: number; name: string | null; withdrawn: number; technicianId: number | null; net: number | null }[] = [];
  for (const acc of employeeAccounts) {
    const a = await prisma.moneyTx.aggregate({ where: { isDeleted: false, accountId: acc.id }, _sum: { moneyOut: true } });
    const tech = await prisma.technician.findFirst({ where: { accountId: acc.id, isDeleted: false }, select: { id: true, name: true, salary: true } });
    let net: number | null = null;
    if (tech) net = (await statementForTechnician(tech.id, tech.salary ?? 0, agent?.salaryFromDay, agent?.salaryToDay)).net;
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
    salaryFromTotal,
    masterBalance,
    employees,
    transactions: mgrTxs,
    salaryPeriod: salaryPeriodInfo,
  });
}
