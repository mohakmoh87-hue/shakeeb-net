import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

// التقرير الاجمالي: إحصائيات شاملة للنظام
export async function GET(request: Request) {
  const g = await guard("reports.view");
  if (g.error) return g.error;

  const now = new Date();

  // مدة اختيارية لحساب من فعّل خلالها
  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const from = fromStr ? new Date(fromStr) : new Date(new Date().setDate(1));
  const to = toStr ? new Date(toStr) : new Date();
  to.setHours(23, 59, 59, 999);

  const scope = await towerScope(g.session); // فلتر المكتب (الأدمن يرى الكل)

  // المشتركون الذين فعّلوا اشتراكهم خلال المدة (مميّزون — كل مشترك مرة واحدة)
  const activatedGroups = await prisma.subscriptionEntry.groupBy({
    by: ["subscriberId"],
    where: { isDeleted: false, date: { gte: from, lte: to }, subscriberId: { not: null }, ...scope },
  });

  const [
    subsTotal,
    subsActive,
    subsExpired,
    packages,
    towers,
    cash,
    debts,
    invoicesAgg,
    activationsAgg,
    messagesSent,
  ] = await Promise.all([
    prisma.subscriber.count({ where: { isDeleted: false, ...scope } }),
    prisma.subscriber.count({
      where: { isDeleted: false, dateTo: { gte: now }, ...scope },
    }),
    prisma.subscriber.count({
      where: { isDeleted: false, dateTo: { lt: now }, ...scope },
    }),
    prisma.package.count({ where: { isDeleted: false } }),
    prisma.tower.count({ where: { isDeleted: false } }),
    prisma.moneyTx.aggregate({
      // حساب الماستر مستقل — لا يدخل بالتقرير الإجمالي
      where: { isDeleted: false, ...scope, OR: [{ sourceType: null }, { sourceType: { not: "master" } }] },
      _sum: { moneyIn: true, moneyOut: true },
    }),
    prisma.subscriber.aggregate({
      where: { isDeleted: false, carry: { gt: 0 }, ...scope },
      _sum: { carry: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { isDeleted: false, ...scope },
      _sum: { totalMy: true },
      _count: true,
    }),
    prisma.subscriptionEntry.aggregate({
      where: { isDeleted: false, ...scope },
      _sum: { money: true, moneyIn: true },
      _count: true,
    }),
    prisma.message.count({ where: { status: "SENT" } }),
  ]);

  return NextResponse.json({
    subscribers: {
      total: subsTotal,
      active: subsActive,
      expired: subsExpired,
      inactive: subsTotal - subsActive, // غير مفعّلين (منتهون أو بلا تفعيل)
    },
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      activated: activatedGroups.length, // عدد المشتركين الذين فعّلوا خلال المدة
    },
    packages,
    towers,
    cash: {
      totalIn: cash._sum.moneyIn ?? 0,
      totalOut: cash._sum.moneyOut ?? 0,
      balance: (cash._sum.moneyIn ?? 0) - (cash._sum.moneyOut ?? 0),
    },
    debts: { total: debts._sum.carry ?? 0, count: debts._count },
    invoices: { count: invoicesAgg._count, total: invoicesAgg._sum.totalMy ?? 0 },
    activations: {
      count: activationsAgg._count,
      total: activationsAgg._sum.money ?? 0,
      collected: activationsAgg._sum.moneyIn ?? 0,
    },
    messagesSent,
  });
}
