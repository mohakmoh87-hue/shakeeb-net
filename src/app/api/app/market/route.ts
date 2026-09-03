import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { ensureMarketTable, cleanPhoto, priceToNum } from "@/lib/market";
import { getMarketCategories } from "@/lib/appConfig";

export const dynamic = "force-dynamic";

// 🛒 سوق المستعمل — GET: تصفّحُ المعروض (visible) + الفئات. مفتوحٌ (للزائر أيضاً) كي يُرى قبل الدخول.
export async function GET(request: Request) {
  await ensureMarketTable();
  const url = new URL(request.url);
  const cat = (url.searchParams.get("cat") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const PAGE = 20;
  const where: { status: string; category?: string; OR?: { title?: { contains: string }; description?: { contains: string } }[] } = { status: "visible" };
  if (cat) where.category = cat;
  if (q) where.OR = [{ title: { contains: q } }, { description: { contains: q } }];
  const [items, total, categories] = await Promise.all([
    prisma.marketListing.findMany({
      where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE, take: PAGE,
      select: { id: true, sellerName: true, title: true, price: true, description: true, phone: true, photo: true, category: true, createdAt: true },
    }),
    prisma.marketListing.count({ where }),
    getMarketCategories(),
  ]);
  return NextResponse.json({ items: items.map((i) => ({ ...i, price: priceToNum(i.price) })), total, page, pages: Math.ceil(total / PAGE), categories });
}

// POST: نشرُ إعلان — يحتاج جلسةَ مشترك + غيرَ محظور + خانقاً.
export async function POST(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "سجّل الدخول لنشر إعلان" }, { status: 401 });
  if (!rateLimit(`market-post:${sess.subscriberId}`, 5, 300_000)) {
    return NextResponse.json({ error: "إعلاناتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  await ensureMarketTable();
  const sub = await prisma.subscriber.findUnique({ where: { id: sess.subscriberId }, select: { id: true, name: true, phone: true, appBanned: true } });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (sub.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });
  const b = await request.json().catch(() => null);
  const title = typeof b?.title === "string" ? b.title.trim().slice(0, 120) : "";
  const description = typeof b?.description === "string" ? b.description.trim().slice(0, 1000) : "";
  const phone = typeof b?.phone === "string" && b.phone.trim() ? b.phone.trim().slice(0, 20) : (sub.phone ?? "");
  const category = typeof b?.category === "string" ? b.category.trim().slice(0, 80) : "";
  const priceRaw = Number(b?.price);
  const price = Number.isFinite(priceRaw) && priceRaw >= 0 && priceRaw <= 1e13 ? Math.round(priceRaw) : null;
  const photo = cleanPhoto(b?.photo);
  if (!title || !phone.trim()) return NextResponse.json({ error: "العنوان ورقم الهاتف مطلوبان" }, { status: 400 });
  const cats = await getMarketCategories();
  // سقفٌ صارمٌ لعدد إعلانات البائع (٣٠): قفلٌ استشاريٌّ لكلّ بائعٍ يُسلسِل العدَّ+الإنشاءَ داخل
  // معاملةٍ واحدة، فلا يتجاوزه نشرٌ متزامنٌ خاطف (يكمّل الخانقَ اللحظيّ ضدّ الإغراق).
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4200, ${sub.id}::int)`;
    if ((await tx.marketListing.count({ where: { sellerId: sub.id } })) >= 30) return null;
    return tx.marketListing.create({
      data: {
        sellerId: sub.id, sellerName: sub.name ?? null, title, price: price != null ? BigInt(price) : null, description: description || null,
        phone: phone.trim(), photo, category: cats.includes(category) ? category : null, status: "visible",
      },
      select: { id: true },
    });
  });
  if (!created) return NextResponse.json({ error: "بلغتَ حدَّ الإعلانات (٣٠) — احذف قديماً لتنشر جديداً" }, { status: 400 });
  return NextResponse.json({ ok: true, id: created.id });
}
