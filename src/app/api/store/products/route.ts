import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { ensureAgentStoreTables, liveStockFor } from "@/lib/agentStore";
import { cleanPhoto, priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

// متجرُ الوكيل — إدارةُ الوكيل لكتالوجه (معزولٌ بـagentId؛ متجرٌ على مستوى الوكيل لا المكتب).
// الرسومُ (توصيل/تنصيب) على مستوى الوكيل في /api/store/settings، لا لكلّ منتج.
export async function GET() {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentStoreTables();
  const items = await prisma.agentProduct.findMany({ where: { agentId }, orderBy: { id: "desc" } });
  const live = await liveStockFor(items.map((i) => ({ id: i.id, agentId: i.agentId, itemName: i.itemName })));
  return NextResponse.json({
    items: items.map((i) => ({
      ...i, price: priceToNum(i.price), deliveryFee: priceToNum(i.deliveryFee), installFee: priceToNum(i.installFee),
      stock: i.itemName ? (live.get(i.id) ?? 0) : i.stock, linked: !!i.itemName,
    })),
  });
}

export async function POST(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذه الجلسة" }, { status: 400 });
  await ensureAgentStoreTables();
  const b = await request.json().catch(() => null);
  const title = typeof b?.title === "string" ? b.title.trim().slice(0, 120) : "";
  if (!title) return NextResponse.json({ error: "اسمُ المنتج مطلوب" }, { status: 400 });
  const description = typeof b?.description === "string" ? b.description.trim().slice(0, 1000) : "";
  const category = typeof b?.category === "string" ? b.category.trim().slice(0, 80) : "";
  const itemName = typeof b?.itemName === "string" && b.itemName.trim() ? b.itemName.trim().slice(0, 120) : null;
  const priceRaw = Number(b?.price);
  const price = Number.isFinite(priceRaw) && priceRaw >= 0 && priceRaw <= 1e13 ? Math.round(priceRaw) : null;
  const stockRaw = Number(b?.stock);
  const stock = itemName ? null : (Number.isFinite(stockRaw) && stockRaw >= 0 && stockRaw <= 1e9 ? Math.round(stockRaw) : null);
  const photo = cleanPhoto(b?.photo);
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } });
  const t = await prisma.agentProduct.create({
    data: {
      agentId, agentName: agent?.name ?? null, title, itemName,
      price: price != null ? BigInt(price) : null, description: description || null,
      category: category || null, stock, photo, status: "visible",
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: t.id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentStoreTables();
  const b = await request.json().catch(() => null);
  const id = Number(b?.id) || 0;
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const own = await prisma.agentProduct.findFirst({ where: { id, agentId }, select: { id: true, itemName: true } });
  if (!own) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (b?.status === "visible" || b?.status === "hidden") {
    await prisma.agentProduct.update({ where: { id }, data: { status: b.status } });
    return NextResponse.json({ ok: true });
  }
  const data: Record<string, unknown> = {};
  let linked = own.itemName != null; // حالةُ الربط بعد هذا التعديل — المخزونُ اليدويُّ للحرّ فقط
  if (typeof b?.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 120);
  if (typeof b?.description === "string") data.description = b.description.trim().slice(0, 1000) || null;
  if (typeof b?.category === "string") data.category = b.category.trim().slice(0, 80) || null;
  if (b?.itemName !== undefined) {
    const nm = typeof b.itemName === "string" && b.itemName.trim() ? b.itemName.trim().slice(0, 120) : null;
    data.itemName = nm;
    linked = nm != null;
    if (nm) data.stock = null; // المربوطُ يعرض عددَ المخزن حيّاً
  }
  if (b?.price === null) data.price = null;
  else if (b?.price !== undefined) { const p = Number(b.price); data.price = Number.isFinite(p) && p >= 0 && p <= 1e13 ? BigInt(Math.round(p)) : null; }
  if (b?.stock !== undefined && !linked) {
    const s = Number(b.stock);
    data.stock = Number.isFinite(s) && s >= 0 && s <= 1e9 ? Math.round(s) : null;
  }
  if (b?.photo !== undefined) data.photo = cleanPhoto(b.photo);
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  await prisma.agentProduct.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentStoreTables();
  const id = Number(new URL(request.url).searchParams.get("id")) || 0;
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const own = await prisma.agentProduct.findFirst({ where: { id, agentId }, select: { id: true } });
  if (!own) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.agentProduct.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
