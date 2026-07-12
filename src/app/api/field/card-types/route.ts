import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// أنواع البطاقات (متاحة للجميع للاختيار)
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const types = await prisma.cardType.findMany({
    where: { isDeleted: false }, orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ types });
}

// إنشاء نوع بطاقة جديد — صلاحية إدارة الفنيين
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "اسم النوع مطلوب" }, { status: 400 });
  const exists = await prisma.cardType.findFirst({ where: { name, isDeleted: false } });
  if (exists) return NextResponse.json(exists, { status: 200 });
  const count = await prisma.cardType.count({ where: { isDeleted: false } });
  const created = await prisma.cardType.create({
    data: { name, deliveryOnly: !!b?.deliveryOnly, position: count },
  });
  return NextResponse.json(created, { status: 201 });
}

// حذف نوع (منطقي) — صلاحية إدارة الفنيين
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  await prisma.cardType.updateMany({ where: { id }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
