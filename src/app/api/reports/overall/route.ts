import { NextResponse } from "next/server";
import { notMaster } from "@/lib/moneyKinds";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { guard, towerScope, agentOfficeFilter, agentTowerIds } from "@/lib/guard";

// التقرير الاجمالي: إحصائيات شاملة للنظام
export async function GET(request: Request) {
  const g = await guard("reports.view");
  if (g.error) return g.error;

  const now = new Date();

  // مدة اختيارية لحساب من فعّل خلالها
  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  // ?all=1 ⇒ كل التواريخ (لا مدى) — انظر تعليق التقرير التفصيلي
  const allDates = url.searchParams.get("all") === "1";
  const from = fromStr ? new Date(fromStr) : new Date(new Date().setDate(1));
  const to = toStr ? new Date(toStr) : new Date();
  to.setHours(23, 59, 59, 999);
  const range = allDates ? undefined : { gte: from, lte: to };

  const scope = await towerScope(g.session); // فلتر المكتب (معزول بالوكيل)
  // عزل بقيّة العدّادات بالوكيل أيضاً (كانت تعدّ كلّ الوكلاء — تسريب عزل):
  const officeFilter = await agentOfficeFilter(g.session); // فلتر جدول المكاتب بالـ id
  const agentTowersForMsg = await agentTowerIds(g.session);
  const msgTowerIds = agentTowersForMsg.length ? agentTowersForMsg : [-1];
  const myAgentId = g.session.agentId ?? -1;

  // المشتركون الذين فعّلوا اشتراكهم خلال المدة (مميّزون — كل مشترك مرة واحدة)
  const activatedGroups = await prisma.subscriptionEntry.groupBy({
    by: ["subscriberId"],
    where: { isDeleted: false, date: range, subscriberId: { not: null }, ...scope },
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
    messagesSentRows,
  ] = await Promise.all([
    prisma.subscriber.count({ where: { isDeleted: false, ...scope } }),
    prisma.subscriber.count({
      where: { isDeleted: false, dateTo: { gte: now }, ...scope },
    }),
    prisma.subscriber.count({
      where: { isDeleted: false, dateTo: { lt: now }, ...scope },
    }),
    prisma.package.count({ where: { isDeleted: false, agentId: myAgentId } }),
    prisma.tower.count({ where: { isDeleted: false, ...officeFilter } }),
    prisma.moneyTx.aggregate({
      // حساب الماستر مستقل — لا يدخل بالتقرير الإجمالي
      where: { isDeleted: false, ...scope, ...notMaster },
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
    // الرسائل المرسَلة لمشتركي مكاتب هذا الوكيل فقط (Message بلا towerId — تُربط بالمشترك)
    prisma.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT count(*)::int AS count FROM messages m JOIN subscribers s ON s.id = m."subscriberId" WHERE m.status::text = 'SENT' AND s."towerId" IN (${Prisma.join(msgTowerIds)})`),
  ]);
  const messagesSent = Number(messagesSentRows?.[0]?.count ?? 0);

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
