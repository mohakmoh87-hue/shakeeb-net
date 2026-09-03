import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { ensureMarketTable, priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

// إعلاناتي + حذفُ إعلاني — معزولٌ بـsellerId = جلسة المشترك (لا يمسّ إعلانَ غيره).
export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  await ensureMarketTable();
  const items = await prisma.marketListing.findMany({
    where: { sellerId: sess.subscriberId }, orderBy: { id: "desc" },
    select: { id: true, title: true, price: true, description: true, phone: true, photo: true, category: true, status: true, createdAt: true },
  });
  return NextResponse.json({ items: items.map((i) => ({ ...i, price: priceToNum(i.price) })) });
}

export async function DELETE(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id")) || 0;
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  await ensureMarketTable();
  const own = await prisma.marketListing.findFirst({ where: { id, sellerId: sess.subscriberId }, select: { id: true } });
  if (!own) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.marketListing.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
