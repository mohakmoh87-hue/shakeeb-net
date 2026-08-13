import { NextResponse } from "next/server";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";
import { baghdadDayKey } from "@/lib/attendance";
import { notMaster } from "@/lib/moneyKinds";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

// التقرير التفصيلي: الحركات ضمن مدة (تفعيلات + قبض/صرف)
export async function GET(request: Request) {
  const g = await guard("reports.view");
  if (g.error) return g.error;

  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  // ?all=1 ⇒ **كل التواريخ** بلا مدى (قرار محمد 2026-08-05): المدى كان مفروضاً من أول
  // الشهر إلى اليوم، فلا سبيل لسؤال «كل شيء منذ البداية» — والآن الاختيار بيد المستخدم.
  const allDates = url.searchParams.get("all") === "1";
  // ب-٨ · حدودُ اليوم **بتوقيت بغداد** لا بتوقيت الخادم (UTC) — وإلّا صارت النافذةُ
  //   مُزاحةً ٣ ساعاتٍ فتُخالف الصندوقَ والتقريرَ اليوميّ. والافتراضاتُ بغداديّةٌ أيضاً.
  const bgToday = baghdadDayKey(new Date());
  const from = baghdadStart(fromStr || `${bgToday.slice(0, 7)}-01`)!;
  const to = baghdadEnd(toStr || bgToday)!;

  const range = allDates ? undefined : { gte: from, lte: to };
  const scope = await towerScope(g.session);

  const [entries, money, entriesAgg, moneyAgg] = await Promise.all([
    prisma.subscriptionEntry.findMany({
      where: { isDeleted: false, date: range, ...scope },
      orderBy: { id: "desc" },
      take: 500,
    }),
    prisma.moneyTx.findMany({
      where: { isDeleted: false, date: range, ...scope, ...notMaster },
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
      where: { isDeleted: false, date: range, ...scope, ...notMaster },
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
