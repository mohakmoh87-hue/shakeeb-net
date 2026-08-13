import { NextResponse } from "next/server";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";
import { prisma } from "@/lib/prisma";
import { guardAny, towerScope } from "@/lib/guard";

export const dynamic = "force-dynamic";

// «تقرير الفواتير» = سجل المواد المباعة حصراً: كل سطر مادة بيعت ضمن فاتورة —
// من فاتورة المبيع (بيع/بيع مباشر) أو من ذمة فني (بيع صيانة).
// فلاتر: تاريخ (من/إلى) + بحث حر (مادة/مشترٍ/فني/رقم فاتورة/نوع/ملاحظة).
// العزل: فواتير مكاتب المستخدم فقط (+ فواتير بلا مكتب أنشأها هو).
export async function GET(request: Request) {
  const g = await guardAny("inventory.manage", "finance.view");
  if (g.error) return g.error;
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const q = (sp.get("q") ?? "").trim().toLowerCase();

  const dateFilter: { gte?: Date; lte?: Date } = {};
  // ب-٨ · بدايةُ اليوم ونهايتُه **بتوقيت بغداد** لا بتوقيت الخادم (UTC)
  { const d = baghdadStart(from); if (d) dateFilter.gte = d; }
  { const d = baghdadEnd(to); if (d) dateFilter.lte = d; }

  const scope = await towerScope(g.session!);
  const invWhere = {
    isDeleted: false,
    OR: [{ ...scope }, { towerId: null, user: g.session!.username }],
    ...(dateFilter.gte || dateFilter.lte ? { date: dateFilter } : {}),
  };
  // المجموع الحقيقي يُحسب على **كل** الفواتير المطابقة لا على المعروض منها —
  // كان يُحسب من الـ500 المقصوصة فيخرج مجموعٌ خاطئ لا ناقص فقط (تدقيق 2026-08-04).
  const matchedInvoices = await prisma.invoice.count({ where: invWhere });
  const PAGE = 2000;
  const invoices = await prisma.invoice.findMany({
    where: invWhere,
    orderBy: { id: "desc" },
    take: PAGE,
    select: { id: true, number: true, date: true, type: true, note: true, user: true, subscriberId: true, towerId: true },
  });
  if (invoices.length === 0) return NextResponse.json({ rows: [], totalAmount: 0, invoiceCount: 0, matchedInvoices, truncated: false, partialTotal: false });

  const invById = new Map(invoices.map((i) => [i.id, i]));
  const lines = await prisma.invoiceItem.findMany({
    where: { invoiceId: { in: invoices.map((i) => i.id) }, isDeleted: false },
    orderBy: { id: "desc" },
  });

  // أسماء المواد والمشتركين والمكاتب دفعة واحدة
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is number => x != null))];
  const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }) : [];
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const subIds = [...new Set(invoices.map((i) => i.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true } }) : [];
  const subName = new Map(subs.map((s) => [s.id, s.name ?? s.netUser ?? `#${s.id}`]));
  const towerIds = [...new Set(invoices.map((i) => i.towerId).filter((x): x is number => x != null))];
  const towers = towerIds.length ? await prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } }) : [];
  const towerName = new Map(towers.map((t) => [t.id, t.name]));

  const rows = lines.filter((l) => l.invoiceId != null && invById.has(l.invoiceId)).map((l) => {
    const inv = invById.get(l.invoiceId!)!;
    // المشتري: المشترك المرتبط، وإلا اسم الزبون من الملاحظة (بيع مباشر)
    const buyer = (inv.subscriberId != null ? subName.get(inv.subscriberId) : null)
      ?? inv.note?.match(/الزبون\s*[:：]\s*([^—\n]+)/)?.[1]?.trim()
      ?? (inv.type === "بيع مباشر" ? "بيع مباشر" : "—");
    // الفني (لبيع الصيانة من ذمّته): من ملاحظة الفاتورة «— الفني X»
    const tech = inv.type === "بيع صيانة" ? inv.note?.match(/الفني\s+([^—(\n]+)/)?.[1]?.trim() ?? null : null;
    return {
      lineId: l.id,
      invoiceId: inv.id,
      number: inv.number ?? inv.id,
      date: inv.date,
      item: l.itemId != null ? itemName.get(l.itemId) ?? "—" : "—",
      count: l.count ?? 0,
      price: l.price ?? 0,
      total: (l.count ?? 0) * (l.price ?? 0),
      type: inv.type ?? "بيع",
      buyer,
      tech,
      office: inv.towerId != null ? towerName.get(inv.towerId) ?? null : null,
      byUser: inv.user ?? null,
    };
  });

  // البحث الحر على كل الحقول الظاهرة
  const filtered = q
    ? rows.filter((r) =>
        [r.item, r.buyer, r.tech, r.type, r.office, r.byUser, String(r.number), String(r.count), String(r.price), String(r.total)]
          .some((v) => (v ?? "").toString().toLowerCase().includes(q)))
    : rows;

  // مجموع كل السطور المطابقة: SUM(count × price) على مستوى القاعدة — يشمل ما لم يُعرض.
  // مع بحث حر لا يمكن حسابه في القاعدة (البحث يجري على أسماء مركّبة)، فيُعلَّم partialTotal
  // ليُصرَّح للمستخدم أن المجموع يخص المعروض لا كل المدة.
  let totalAmount = filtered.reduce((s, r) => s + r.total, 0);
  let invoiceCount = new Set(filtered.map((r) => r.invoiceId)).size;
  const truncated = matchedInvoices > invoices.length;
  const partialTotal = !!q && truncated;
  if (!q) {
    const ids = await prisma.invoice.findMany({ where: invWhere, select: { id: true } });
    const idList = ids.map((x) => x.id);
    invoiceCount = idList.length;
    if (idList.length) {
      const rowsAgg = await prisma.$queryRaw<{ total: bigint | number | null }[]>`
        SELECT COALESCE(SUM("count" * "price"), 0) AS total
        FROM invoice_items WHERE "isDeleted" = false AND "invoiceId" = ANY(${idList})`;
      totalAmount = Number(rowsAgg?.[0]?.total ?? 0);
    } else totalAmount = 0;
  }

  return NextResponse.json({ rows: filtered, totalAmount, invoiceCount, matchedInvoices, truncated, partialTotal });
}
