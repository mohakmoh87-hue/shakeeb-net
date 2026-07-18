import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { agentOwnsBoard, agentOwnsList } from "@/lib/field";

// إدارة الأعمدة للمدير فقط (field.manage) — إضافة/تسمية/حذف/تحديد «محسوب بالوقت».

// إنشاء عمود جديد في اللوحة
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  if (!b?.boardId || !b?.name?.trim()) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  if (!(await agentOwnsBoard(g.session, Number(b.boardId)))) return NextResponse.json({ error: "اللوحة لا تتبع حسابك" }, { status: 403 });
  const count = await prisma.taskList.count({ where: { boardId: Number(b.boardId), isDeleted: false } });
  const created = await prisma.taskList.create({ data: { boardId: Number(b.boardId), name: String(b.name).trim(), position: count, timeTracked: !!b.timeTracked } });
  return NextResponse.json(created, { status: 201 });
}

// تعديل عمود (الاسم/الترتيب/محسوب بالوقت)
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsList(g.session, Number(b.id)))) return NextResponse.json({ error: "العمود لا يتبع حسابك" }, { status: 403 });
  const data: { name?: string; position?: number; timeTracked?: boolean } = {};
  if (typeof b.name === "string") data.name = b.name.trim();
  if (typeof b.position === "number") data.position = b.position;
  if (typeof b.timeTracked === "boolean") data.timeTracked = b.timeTracked;
  const updated = await prisma.taskList.update({ where: { id: Number(b.id) }, data });
  return NextResponse.json(updated);
}

// حذف عمود (وبطاقاته) حذفاً منطقياً
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsList(g.session, id))) return NextResponse.json({ error: "العمود لا يتبع حسابك" }, { status: 403 });
  await prisma.$transaction([
    prisma.taskCard.updateMany({ where: { listId: id }, data: { isDeleted: true } }),
    prisma.taskList.update({ where: { id }, data: { isDeleted: true } }),
  ]);
  return NextResponse.json({ ok: true });
}
