import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { ensureMarketTable, displayName, MAX_COMMENT } from "@/lib/market";

export const dynamic = "force-dynamic";

// 💬 تعليقاتُ إعلانات سوق المستعمل (طلبُ محمد 2026-10-24).
// الاسمُ المعروض يُحَلُّ **عند القراءة** (المستعارُ ثمّ الاسمُ ثمّ اللقطة) — فمن غيّر
// اسمَه المستعارَ تتبعه تعليقاتُه القديمة. ولا حذفَ نهائيّ: `isDeleted` فقط.
export async function GET(request: Request) {
  await ensureMarketTable();
  const listingId = Number(new URL(request.url).searchParams.get("listingId")) || 0;
  if (!listingId) return NextResponse.json({ error: "listingId مطلوب" }, { status: 400 });
  // 🔒 لا تُقرأ تعليقاتُ إعلانٍ مخفيٍّ (أخفاه الأدمن) — كالإعلان نفسِه
  const listing = await prisma.marketListing.findFirst({ where: { id: listingId, status: "visible" }, select: { id: true, sellerId: true } });
  if (!listing) return NextResponse.json({ items: [], canDelete: [] });

  const rows = await prisma.marketComment.findMany({
    where: { listingId, isDeleted: false },
    orderBy: { id: "asc" },
    take: 200,
    select: { id: true, subscriberId: true, authorName: true, text: true, createdAt: true },
  });
  const ids = [...new Set(rows.map((r) => r.subscriberId))];
  const subs = ids.length
    ? await prisma.subscriber.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, appNickname: true } })
    : [];
  const byId = new Map(subs.map((x) => [x.id, x]));

  // يحذف تعليقَه صاحبُه، ويحذف صاحبُ الإعلان أيَّ تعليقٍ على إعلانه
  const sess = await getSubscriberSession();
  const me = sess?.subscriberId ?? null;
  const owner = me != null && me === listing.sellerId;

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      name: displayName(byId.get(r.subscriberId), r.authorName),
      text: r.text,
      createdAt: r.createdAt,
      mine: me != null && r.subscriberId === me,
      canDelete: owner || (me != null && r.subscriberId === me),
    })),
  });
}

export async function POST(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "سجّل الدخول للتعليق" }, { status: 401 });
  if (!rateLimit(`market-cmt:${sess.subscriberId}`, 10, 300_000)) {
    return NextResponse.json({ error: "تعليقاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  await ensureMarketTable();
  const sub = await prisma.subscriber.findFirst({
    where: { id: sess.subscriberId, isDeleted: false, purgedAt: null },
    select: { id: true, name: true, appNickname: true, appBanned: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (sub.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });

  const b = await request.json().catch(() => null);
  const listingId = Number(b?.listingId) || 0;
  const text = typeof b?.text === "string" ? b.text.replace(/\s+/g, " ").trim().slice(0, MAX_COMMENT) : "";
  if (!listingId || !text) return NextResponse.json({ error: "اكتب تعليقك" }, { status: 400 });
  const listing = await prisma.marketListing.findFirst({ where: { id: listingId, status: "visible" }, select: { id: true } });
  if (!listing) return NextResponse.json({ error: "الإعلان لم يعد متاحاً" }, { status: 404 });

  const created = await prisma.marketComment.create({
    data: { listingId, subscriberId: sub.id, authorName: displayName(sub, sub.name), text },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}

// حذفٌ ناعم: صاحبُ التعليق، أو صاحبُ الإعلان على إعلانه — ولا حذفَ نهائيّ أبداً
export async function DELETE(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  await ensureMarketTable();
  const id = Number(new URL(request.url).searchParams.get("id")) || 0;
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const row = await prisma.marketComment.findFirst({ where: { id, isDeleted: false }, select: { id: true, subscriberId: true, listingId: true } });
  if (!row) return NextResponse.json({ ok: true });
  const listing = await prisma.marketListing.findUnique({ where: { id: row.listingId }, select: { sellerId: true } });
  const allowed = row.subscriberId === sess.subscriberId || listing?.sellerId === sess.subscriberId;
  if (!allowed) return NextResponse.json({ error: "لا تملك حذفَ هذا التعليق" }, { status: 403 });
  await prisma.marketComment.update({ where: { id }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
