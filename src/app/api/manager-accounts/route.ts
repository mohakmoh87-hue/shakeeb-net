import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// حسابات المدير (موحّدة عامة): المبلغ الكلي، ديون الكارتات، مصروفات/مقبوضات المدير، وسحوبات الموظفين
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  const [dailyAgg, cardsAgg, mgr, employeeAccounts, mgrTxs] = await Promise.all([
    // مجموع المبالغ اليومية = صافي كل حركات التقرير اليومي عبر كل الأيام
    prisma.moneyTx.aggregate({ where: { isDeleted: false }, _sum: { moneyIn: true, moneyOut: true } }),
    // مجموع مبالغ الكروت المضافة (كلفة الشراء) = ديون الكارتات قبل التسديد
    prisma.rechargeCard.aggregate({ where: {}, _sum: { price: true } }),
    // حركات المدير مجمّعة حسب النوع
    prisma.managerTx.groupBy({ by: ["type"], where: { isDeleted: false }, _sum: { amount: true } }),
    // حسابات الموظفين (للعرض فقط: كم سحب كل موظف من التقرير اليومي)
    prisma.account.findMany({ where: { isDeleted: false, isEmployee: true }, select: { id: true, name: true } }),
    // سجل حركات المدير
    prisma.managerTx.findMany({ where: { isDeleted: false }, orderBy: { id: "desc" }, take: 200 }),
  ]);

  const cumulativeDaily = (dailyAgg._sum.moneyIn ?? 0) - (dailyAgg._sum.moneyOut ?? 0);
  const cardDebtAdded = cardsAgg._sum.price ?? 0;
  const sumBy = (t: string) => mgr.find((m) => m.type === t)?._sum.amount ?? 0;
  const cardPayments = sumBy("card-payment");
  const managerExpenses = sumBy("expense");
  const managerReceipts = sumBy("receipt");

  const cardDebtRemaining = cardDebtAdded - cardPayments;
  const totalAvailable = cumulativeDaily - cardPayments - managerExpenses + managerReceipts;

  // سحوبات الموظفين = مصروفات التقرير اليومي (moneyOut) على حساب الموظف
  const employees: { id: number; name: string | null; withdrawn: number }[] = [];
  for (const acc of employeeAccounts) {
    const a = await prisma.moneyTx.aggregate({ where: { isDeleted: false, accountId: acc.id }, _sum: { moneyOut: true } });
    employees.push({ id: acc.id, name: acc.name, withdrawn: a._sum.moneyOut ?? 0 });
  }

  return NextResponse.json({
    cumulativeDaily,
    totalAvailable,
    cardDebtAdded,
    cardPayments,
    cardDebtRemaining,
    managerExpenses,
    managerReceipts,
    employees,
    transactions: mgrTxs,
  });
}
