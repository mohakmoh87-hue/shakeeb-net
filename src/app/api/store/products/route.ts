import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { ensureAgentStoreTables } from "@/lib/agentStore";
import { cleanPhoto, priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

// متجرُ الوكيل — إدارةُ الوكيل لكتالوجه (معزولٌ بـagentId؛ متجرٌ على مستوى الوكيل لا المكتب).
export async function GET() {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentStoreTables();
  const items = await prisma.agentProduct.findMany({ where: { agentId }, orderBy: { id: "desc" } });
  return NextResponse.json({ items: items.map((i) => ({ ...i, price: priceToNum(i.price) })) });
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
  const priceRaw = Number(b?.price);
  const price = Number.isFinite(priceRaw) && priceRaw >= 0 && priceRaw <= 1e13 ? Math.round(priceRaw) : null;
  const stockRaw = Number(b?.stock);
  const stock = Number.isFinite(stockRaw) && stockRaw >= 0 && stockRaw <= 1e9 ? Math.round(stockRaw) : null;
  const photo = cleanPhoto(b?.photo);
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } });
  const t = await prisma.agentProduct.create({
    data: {
      agentId, agentName: agent?.name ?? null, title, price: price != null ? BigInt(price) : null,
      description: description || null, category: category || null, stock, photo, status: "visible",
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
  const own = await prisma.agentProduct.findFirst({ where: { id, agentId }, select: { id: true } });
  if (!own) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  // تبديلُ الحالة فقط
  if (b?.status === "visible" || b?.status === "hidden") {
    await prisma.agentProduct.update({ where: { id }, data: { status: b.status } });
    return NextResponse.json({ ok: true });
  }
  // تحريرُ الحقول
  const data: Record<string, unknown> = {};
  if (typeof b?.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 120);
  if (typeof b?.description === "string") data.description = b.description.trim().slice(0, 1000) || null;
  if (typeof b?.category === "string") data.category = b.category.trim().slice(0, 80) || null;
  if (b?.price === null) data.price = null;
  else if (b?.price !== undefined) {
    const p = Number(b.price);
    data.price = Number.isFinite(p) && p >= 0 && p <= 1e13 ? BigInt(Math.round(p)) : null;
  }
  if (b?.stock === null) data.stock = null;
  else if (b?.stock !== undefined) {
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
