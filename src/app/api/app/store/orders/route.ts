import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { ensureAgentStoreTables } from "@/lib/agentStore";
import { priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

// طلباتي (المشترك) — معزولةٌ بـsubscriberId.
export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  await ensureAgentStoreTables();
  const items = await prisma.storeOrder.findMany({ where: { subscriberId: sess.subscriberId }, orderBy: { id: "desc" }, take: 100 });
  return NextResponse.json({ items: items.map((o) => ({ ...o, price: priceToNum(o.price), deliveryFee: priceToNum(o.deliveryFee), installFee: priceToNum(o.installFee) })) });
}

// نشرُ طلبٍ ⇒ يصل الوكيلَ البائع (agentId من المنتج). لا مالَ ولا خصمَ مخزون.
export async function POST(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "سجّل الدخول لإرسال طلب" }, { status: 401 });
  if (!rateLimit(`store-order:${sess.subscriberId}`, 10, 300_000)) {
    return NextResponse.json({ error: "طلباتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  await ensureAgentStoreTables();
  const sub = await prisma.subscriber.findUnique({ where: { id: sess.subscriberId }, select: { id: true, name: true, phone: true, appBanned: true } });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (sub.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });
  const b = await request.json().catch(() => null);
  const productId = Number(b?.productId) || 0;
  const qtyRaw = Number(b?.qty);
  const qty = Number.isFinite(qtyRaw) && qtyRaw >= 1 && qtyRaw <= 999 ? Math.round(qtyRaw) : 1;
  const address = typeof b?.address === "string" ? b.address.trim().slice(0, 300) : "";
  const phone = typeof b?.phone === "string" && b.phone.trim() ? b.phone.trim().slice(0, 20) : (sub.phone ?? "");
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 500) : "";
  if (!productId) return NextResponse.json({ error: "المنتج مطلوب" }, { status: 400 });
  if (!address) return NextResponse.json({ error: "عنوانُ التوصيل مطلوب" }, { status: 400 });
  if (!phone.trim()) return NextResponse.json({ error: "رقمُ الهاتف مطلوب" }, { status: 400 });
  const product = await prisma.agentProduct.findFirst({ where: { id: productId, status: "visible" }, select: { id: true, agentId: true, title: true, price: true, deliveryFee: true, installFee: true } });
  if (!product) return NextResponse.json({ error: "المنتجُ غيرُ متاح" }, { status: 404 });
  // «توصيل وتنصيب» متاحٌ فقط إن حدّد الوكيلُ مبلغَ تنصيبٍ لهذا المنتج، وإلّا فتوصيلٌ عاديّ.
  const wantInstall = b?.fulfillment === "delivery_install" && product.installFee != null;
  const fulfillment = wantInstall ? "delivery_install" : "delivery";
  const t = await prisma.storeOrder.create({
    data: {
      agentId: product.agentId, subscriberId: sub.id, subscriberName: sub.name ?? null,
      productId: product.id, productTitle: product.title, price: product.price,
      qty, fulfillment, deliveryFee: product.deliveryFee, installFee: wantInstall ? product.installFee : null,
      phone: phone.trim(), address, note: note || null, status: "new",
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: t.id }, { status: 201 });
}

// إلغاءُ طلبي (ما دام «new») — معزولٌ بـsubscriberId.
export async function DELETE(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  await ensureAgentStoreTables();
  const id = Number(new URL(request.url).searchParams.get("id")) || 0;
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  // إلغاءٌ ذرّيٌّ: الملكيّةُ + حالةُ «new» + الكتابةُ في عبارةٍ واحدة (لئلّا يُعيدَ الإلغاءُ قبولاً متزامناً)
  const r = await prisma.storeOrder.updateMany({ where: { id, subscriberId: sess.subscriberId, status: "new" }, data: { status: "cancelled" } });
  if (r.count === 0) {
    const exists = await prisma.storeOrder.findFirst({ where: { id, subscriberId: sess.subscriberId }, select: { id: true } });
    return NextResponse.json({ error: exists ? "لا يمكن إلغاءُ طلبٍ قيدَ المعالجة" : "غير موجود" }, { status: exists ? 400 : 404 });
  }
  return NextResponse.json({ ok: true });
}
