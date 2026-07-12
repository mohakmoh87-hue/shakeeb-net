import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

// التقرير التفصيلي: الحركات ضمن مدة (تفعيلات + قبض/صرف)
export async function GET(request: Request) {
  const g = await guard("reports.view");
  if (g.error) return g.error;

  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  const from = fromStr ? new Date(fromStr) : new Date(new Date().setDate(1));
  const to = toStr ? new Date(toStr) : new Date();
  to.setHours(23, 59, 59, 999);

  const range = { gte: from, lte: to };
  const scope = towerScope(g.session);

  const [entries, money, entriesAgg, moneyAgg] = await Promise.all([
    prisma.subscriptionEntry.findMany({
      where: { isDeleted: false, date: range, ...scope },
      orderBy: { id: "desc" },
      take: 500,
    }),
    prisma.moneyTx.findMany({
      where: { isDeleted: false, date: range, ...scope, OR: [{ sourceType: null }, { sourceType: { not: "master" } }] },
      orderBy: { id: "desc" },
      take: 500,
    }),
    prisma.subscriptionEntry.aggregate({
      where: { isDeleted: false, isMaster: false, date: range, ...scope },
      _sum: { money: true, moneyIn: true },
      _count: true,
    }),
    prisma.moneyTx.aggregate({
      // الماستر مستقل — خارج التقرير التفصيلي
      where: { isDeleted: false, date: range, ...scope, OR: [{ sourceType: null }, { sourceType: { not: "master" } }] },
      _sum: { moneyIn: true, moneyOut: true },
    }),
  ]);

  // ربط أسماء المشتركين
  const ids = [...new Set(entries.map((e) => e.subscriberId).filter(Boolean))];
  const subs = await prisma.subscriber.findMany({
    where: { id: { in: ids as number[] } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(subs.map((s) => [s.id, s.name]));

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    entries: entries.map((e) => ({
      ...e,
      subscriberName: e.subscriberId ? nameMap.get(e.subscriberId) : null,
    })),
    money,
    totals: {
      activationsCount: entriesAgg._count,
      activationsTotal: entriesAgg._sum.money ?? 0,
      activationsCollected: entriesAgg._sum.moneyIn ?? 0,
      cashIn: moneyAgg._sum.moneyIn ?? 0,
      cashOut: moneyAgg._sum.moneyOut ?? 0,
    },
  });
}
