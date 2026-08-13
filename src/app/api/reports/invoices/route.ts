import { NextResponse } from "next/server";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";
import { baghdadDayKey } from "@/lib/attendance";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

// تقرير الفواتير ضمن مدة
export async function GET(request: Request) {
  const g = await guard("reports.view");
  if (g.error) return g.error;

  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  // ?all=1 ⇒ كل التواريخ (لا مدى) — انظر تعليق التقرير التفصيلي
  const allDates = url.searchParams.get("all") === "1";
  // ب-٨ · حدودُ اليوم **بتوقيت بغداد** لا بتوقيت الخادم (UTC) — وإلّا صارت النافذةُ
  //   مُزاحةً ٣ ساعاتٍ فتُخالف الصندوقَ والتقريرَ اليوميّ. والافتراضاتُ بغداديّةٌ أيضاً.
  const bgToday = baghdadDayKey(new Date());
  const from = baghdadStart(fromStr || `${bgToday.slice(0, 7)}-01`)!;
  const to = baghdadEnd(toStr || bgToday)!;

  const where = { isDeleted: false, date: allDates ? undefined : { gte: from, lte: to }, ...(await towerScope(g.session)) };
  const [invoices, agg] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: { id: "desc" }, take: 500 }),
    prisma.invoice.aggregate({
      where,
      _sum: { totalMy: true, waselHim: true },
      _count: true,
    }),
  ]);

  // أسماء المشتركين + أسماء المواد المباعة لكل فاتورة
  const subIds = [...new Set(invoices.map((i) => i.subscriberId).filter(Boolean) as number[])];
  const invIds = invoices.map((i) => i.id);
  const [subsList, lines] = await Promise.all([
    prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true } }),
    prisma.invoiceItem.findMany({ where: { invoiceId: { in: invIds }, isDeleted: false }, select: { invoiceId: true, itemId: true } }),
  ]);
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean) as number[])];
  const itemsList = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } });
  const subMap = new Map(subsList.map((s) => [s.id, s.name]));
  const itemMap = new Map(itemsList.map((i) => [i.id, i.name]));
  const itemsByInvoice = new Map<number, string[]>();
  for (const l of lines) {
    if (l.invoiceId == null) continue;
    const arr = itemsByInvoice.get(l.invoiceId) ?? [];
    arr.push((l.itemId ? itemMap.get(l.itemId) : null) ?? "—");
    itemsByInvoice.set(l.invoiceId, arr);
  }

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    invoices: invoices.map((i) => ({
      ...i,
      subscriberName: i.subscriberId ? subMap.get(i.subscriberId) ?? null : null,
      itemNames: (itemsByInvoice.get(i.id) ?? []).join("، "),
    })),
    totals: {
      count: agg._count,
      total: agg._sum.totalMy ?? 0,
      collected: agg._sum.waselHim ?? 0,
    },
  });
}
