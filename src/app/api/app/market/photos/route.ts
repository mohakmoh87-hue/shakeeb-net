import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { getAppAdminSession } from "@/lib/appAdminAuth";
import { ensureMarketTable, MAX_PHOTOS } from "@/lib/market";

export const dynamic = "force-dynamic";

// 🖼️ صورُ إعلانٍ واحد (حتّى ٥ — طلبُ محمد 2026-10-26). قراءةٌ محضة، وتُجلَب **عند فتح
// الإعلان** لا مع قائمة السوق: خمسُ صورٍ × عشرين إعلاناً في صفحةٍ واحدةٍ تُثقِل الهاتف.
// 🔒 ومَن يُسمَح له: الإعلانُ المعروض (visible) لأيّ أحد، وغيرُ المعروض لصاحبه وحدَه
//    أو لأدمن التطبيق — فلا تُقرأ صورُ إعلانٍ ينتظر الموافقةَ أو مخفيٍّ من أحدٍ آخر.
export async function GET(request: Request) {
  const listingId = Number(new URL(request.url).searchParams.get("listingId")) || 0;
  if (!listingId) return NextResponse.json({ error: "listingId مطلوب" }, { status: 400 });
  await ensureMarketTable();

  const listing = await prisma.marketListing.findUnique({
    where: { id: listingId },
    select: { id: true, status: true, sellerId: true, photo: true },
  });
  if (!listing) return NextResponse.json({ error: "غير موجود" }, { status: 404 });

  if (listing.status !== "visible") {
    const sess = await getSubscriberSession();
    const isOwner = sess != null && sess.subscriberId === listing.sellerId;
    const isAdmin = (await getAppAdminSession()) != null;
    if (!isOwner && !isAdmin) return NextResponse.json({ error: "غير متاح" }, { status: 403 });
  }

  const rows = await prisma.marketPhoto.findMany({
    where: { listingId },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    take: MAX_PHOTOS,
    select: { image: true },
  });
  // إعلانٌ قديمٌ بصورةٍ واحدةٍ في `photo` ولا صفوفَ له هنا ⇒ تُرجَع صورتُه وحدَها
  const images = rows.length ? rows.map((r) => r.image) : listing.photo ? [listing.photo] : [];
  return NextResponse.json({ images });
}
