import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { ensureAgentStoreTables, subscriberAgentId, storeOrderLines } from "@/lib/agentStore";
import { priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

// طلباتي (المشترك) — معزولةٌ بـsubscriberId؛ كلُّ طلبٍ ببنوده.
export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  await ensureAgentStoreTables();
  const orders = await prisma.storeOrder.findMany({ where: { subscriberId: sess.subscriberId }, orderBy: { id: "desc" }, take: 100 });
  const byOrder = await storeOrderLines(orders);
  return NextResponse.json({ items: orders.map((o) => ({ ...o, price: priceToNum(o.price), deliveryFee: priceToNum(o.deliveryFee), installFee: priceToNum(o.installFee), total: priceToNum(o.total), lines: byOrder.get(o.id) ?? [] })) });
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
  const address = typeof b?.address === "string" ? b.address.trim().slice(0, 300) : "";
  const phone = typeof b?.phone === "string" && b.phone.trim() ? b.phone.trim().slice(0, 20) : (sub.phone ?? "");
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 500) : "";
  // بنودُ السلّة items[{productId,qty}] — أو منتجٌ مفردٌ {productId,qty} (توافقٌ خلفيّ)
  const raw: unknown[] = Array.isArray(b?.items) && b.items.length ? b.items : (b?.productId ? [{ productId: b.productId, qty: b.qty }] : []);
  const wanted = raw.map((it) => {
    const o = it as { productId?: unknown; qty?: unknown };
    const q = Number(o?.qty);
    return { productId: Number(o?.productId) || 0, qty: Number.isFinite(q) && q >= 1 && q <= 999 ? Math.round(q) : 1 };
  }).filter((it) => it.productId > 0).slice(0, 50);
  if (!wanted.length) return NextResponse.json({ error: "السلّة فارغة" }, { status: 400 });
  if (!address) return NextResponse.json({ error: "عنوانُ التوصيل مطلوب" }, { status: 400 });
  if (!phone.trim()) return NextResponse.json({ error: "رقمُ الهاتف مطلوب" }, { status: 400 });
  const ids = [...new Set(wanted.map((it) => it.productId))];
  const products = await prisma.agentProduct.findMany({ where: { id: { in: ids }, status: "visible" }, select: { id: true, agentId: true, title: true, price: true } });
  if (products.length !== ids.length) return NextResponse.json({ error: "بعضُ المنتجات لم تعد متاحة" }, { status: 404 });
  if (new Set(products.map((p) => p.agentId)).size > 1) return NextResponse.json({ error: "منتجاتٌ من متاجرَ مختلفة — اطلب من متجرٍ واحدٍ في كلّ مرّة" }, { status: 400 });
  const agentId = products[0].agentId;
  const pById = new Map(products.map((p) => [p.id, p]));
  // رسومُ الوكيل البائع حسب شريحة المشترِي — مرّةً لكامل الفاتورة.
  const viewerAgentId = await subscriberAgentId(sub.id);
  const isSub = viewerAgentId != null && viewerAgentId === agentId;
  const ag = await prisma.agent.findUnique({ where: { id: agentId }, select: { storeDeliverySub: true, storeInstallSub: true, storeDeliveryOther: true, storeInstallOther: true } });
  const deliveryFee = (isSub ? ag?.storeDeliverySub : ag?.storeDeliveryOther) ?? null;
  const installFee = (isSub ? ag?.storeInstallSub : ag?.storeInstallOther) ?? null;
  const wantInstall = b?.fulfillment === "delivery_install" && installFee != null;
  const fulfillment = wantInstall ? "delivery_install" : "delivery";
  let goods = BigInt(0);
  const lines = wanted.map((it) => {
    const p = pById.get(it.productId)!;
    if (p.price != null) goods += p.price * BigInt(it.qty);
    return { productId: p.id, productTitle: p.title, price: p.price, qty: it.qty };
  });
  const total = goods + (deliveryFee ?? BigInt(0)) + (wantInstall ? (installFee ?? BigInt(0)) : BigInt(0));
  const totalQty = wanted.reduce((s, it) => s + it.qty, 0);
  const summary = lines[0].productTitle + (lines.length > 1 ? ` +${lines.length - 1}` : "");
  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.storeOrder.create({
      data: {
        agentId, subscriberId: sub.id, subscriberName: sub.name ?? null,
        productId: lines[0].productId, productTitle: summary, price: null, qty: totalQty, total,
        fulfillment, deliveryFee, installFee: wantInstall ? installFee : null,
        phone: phone.trim(), address, note: note || null, status: "new",
      },
      select: { id: true },
    });
    await tx.storeOrderItem.createMany({ data: lines.map((l) => ({ orderId: o.id, productId: l.productId, productTitle: l.productTitle, price: l.price, qty: l.qty })) });
    return o;
  });
  return NextResponse.json({ ok: true, id: order.id }, { status: 201 });
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
