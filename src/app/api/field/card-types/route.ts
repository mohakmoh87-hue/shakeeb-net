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
    where: { isDeleted: false, agentId: s.agentId ?? -1 }, orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ types });
}

// دقائق ≥ 0 أو null
const toMin = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// إنشاء نوع بطاقة جديد — صلاحية إدارة الفنيين
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "اسم النوع مطلوب" }, { status: 400 });
  const agentId = g.session?.agentId ?? null; // عزل: أنواع وكيل المستخدم
  const exists = await prisma.cardType.findFirst({ where: { name, isDeleted: false, agentId: agentId ?? -1 } });
  if (exists) return NextResponse.json(exists, { status: 200 });
  const count = await prisma.cardType.count({ where: { isDeleted: false, agentId: agentId ?? -1 } });
  const created = await prisma.cardType.create({
    data: { name, deliveryOnly: !!b?.deliveryOnly, position: count, agentId, execMinutes: toMin(b?.execMinutes), overrunDeduction: toMin(b?.overrunDeduction) },
  });
  return NextResponse.json(created, { status: 201 });
}

// تعديل نوع (الاسم/التوصيل/الوقت المسموح/خصم التجاوز) — صلاحية إدارة الفنيين + عزل الوكيل
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const agentId = g.session?.agentId ?? -1;
  const type = await prisma.cardType.findFirst({ where: { id, agentId, isDeleted: false } });
  if (!type) return NextResponse.json({ error: "النوع غير موجود" }, { status: 404 });
  const data: { name?: string; deliveryOnly?: boolean; execMinutes?: number | null; overrunDeduction?: number | null } = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.deliveryOnly === "boolean") data.deliveryOnly = b.deliveryOnly;
  if ("execMinutes" in b) data.execMinutes = toMin(b.execMinutes);
  if ("overrunDeduction" in b) data.overrunDeduction = toMin(b.overrunDeduction);
  const updated = await prisma.cardType.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// حذف نوع (منطقي) — صلاحية إدارة الفنيين
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  await prisma.cardType.updateMany({ where: { id, agentId: g.session?.agentId ?? -1 }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
