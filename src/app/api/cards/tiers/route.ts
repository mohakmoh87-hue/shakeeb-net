import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;

  const b = await request.json().catch(() => null);
  const id = b?.id != null ? Number(b.id) : null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 60) : "";
  const price = Number(b?.price);
  if (!name) return NextResponse.json({ error: "اسمُ الفئة مطلوب" }, { status: 400 });
  if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: "سعرٌ غير صالح" }, { status: 400 });

  if (id != null) {
    const owned = await prisma.distributorTier.findFirst({ where: { id, distributorId, isDeleted: false }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "الفئةُ غير موجودة" }, { status: 404 });
    const t = await prisma.distributorTier.update({ where: { id }, data: { name, price } });
    return NextResponse.json({ ok: true, id: t.id });
  }
  const t = await prisma.distributorTier.create({ data: { distributorId, name, price } });
  return NextResponse.json({ ok: true, id: t.id });
}

export async function DELETE(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "حدّد الفئة" }, { status: 400 });
  const owned = await prisma.distributorTier.findFirst({ where: { id, distributorId, isDeleted: false }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "الفئةُ غير موجودة" }, { status: 404 });
  const stock = await prisma.distributorCard.count({ where: { distributorId, tierId: id, transferId: null, isDeleted: false } });
  if (stock > 0) return NextResponse.json({ error: `لا يمكن حذفُ فئةٍ فيها ${stock} كارتاً في المخزن` }, { status: 400 });
  await prisma.distributorTier.update({ where: { id }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
