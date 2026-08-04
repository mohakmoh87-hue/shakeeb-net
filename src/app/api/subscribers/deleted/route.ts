import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";
import { restoreSubscribers, purgeSubscribersFinal } from "@/lib/subscriberDelete";

export const dynamic = "force-dynamic";

// ===== أرشيف المشتركين المحذوفين (المُعطَّلين) =====
// الحذف صار تعطيلاً لا محواً، فوصولات المشترك وفواتيره وحركاته باقية كما هي —
// ولذلك الاسترجاع يعيده كاملاً بضغطة. وقبل هذا لم يكن للحذف رجعة إطلاقاً.
export async function GET() {
  const g = await guard("subscribers.delete");
  if (g.error) return g.error;

  const subs = await prisma.subscriber.findMany({
    where: { isDeleted: true, purgedAt: null, ...(await towerScope(g.session)) },
    orderBy: { id: "desc" },
    take: 500,
    select: { id: true, name: true, netUser: true, phone: true, carry: true, towerId: true, dateTo: true },
  });
  if (!subs.length) return NextResponse.json({ rows: [] });

  const ids = subs.map((s) => s.id);
  const [entries, invoices, towers] = await Promise.all([
    prisma.subscriptionEntry.groupBy({
      by: ["subscriberId"],
      where: { subscriberId: { in: ids }, isDeleted: false },
      _count: true, _sum: { moneyIn: true },
    }),
    prisma.invoice.groupBy({
      by: ["subscriberId"],
      where: { subscriberId: { in: ids }, isDeleted: false },
      _count: true,
    }),
    prisma.tower.findMany({ where: { id: { in: subs.map((s) => s.towerId).filter((x): x is number => x != null) } }, select: { id: true, name: true } }),
  ]);
  const eBy = new Map(entries.map((e) => [e.subscriberId as number, e]));
  const iBy = new Map(invoices.map((i) => [i.subscriberId as number, i]));
  const officeName = new Map(towers.map((t) => [t.id, t.name]));

  return NextResponse.json({
    rows: subs.map((s) => ({
      id: s.id, name: s.name, netUser: s.netUser, phone: s.phone, carry: s.carry ?? 0,
      office: s.towerId != null ? officeName.get(s.towerId) ?? null : null,
      receipts: eBy.get(s.id)?._count ?? 0,
      receiptsTotal: eBy.get(s.id)?._sum.moneyIn ?? 0,
      invoices: iBy.get(s.id)?._count ?? 0,
    })),
  });
}

// استرجاع مشترك (أو أكثر) — بنفس صلاحية الحذف
export async function POST(request: Request) {
  const g = await guard("subscribers.delete");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return NextResponse.json({ error: "لم تُحدَّد أسماء" }, { status: 400 });

  // عزل: لا يُسترجَع إلا مشترك ضمن نطاق مكاتب المستخدم
  const owned = await prisma.subscriber.findMany({
    where: { id: { in: ids }, isDeleted: true, purgedAt: null, ...(await towerScope(g.session)) },
    select: { id: true },
  });
  if (!owned.length) return NextResponse.json({ error: "لا مشترك مطابق ضمن حسابك" }, { status: 404 });

  const actor = { userId: g.session?.userId ?? null, name: g.session?.fullName ?? g.session?.username ?? null };

  // المسح النهائي: يمحو بيانات المشترك ويُبقي اسمه — ولا يمسّ وصلاً ولا حركة مالية
  if (body?.action === "purge") {
    const { purged } = await purgeSubscribersFinal(owned.map((s) => s.id), actor);
    return NextResponse.json({ ok: true, purged });
  }

  const { restored } = await restoreSubscribers(owned.map((s) => s.id), actor);
  return NextResponse.json({ ok: true, restored });
}
