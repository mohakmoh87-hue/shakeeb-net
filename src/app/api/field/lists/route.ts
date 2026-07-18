import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentOwnsBoard, agentOwnsList } from "@/lib/field";

// إنشاء عمود جديد في اللوحة
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.boardId || !b?.name?.trim()) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  if (!(await agentOwnsBoard(s, Number(b.boardId)))) return NextResponse.json({ error: "اللوحة لا تتبع حسابك" }, { status: 403 });
  const count = await prisma.taskList.count({ where: { boardId: Number(b.boardId), isDeleted: false } });
  const created = await prisma.taskList.create({ data: { boardId: Number(b.boardId), name: String(b.name).trim(), position: count } });
  return NextResponse.json(created, { status: 201 });
}

// تعديل عمود (الاسم/الترتيب)
export async function PATCH(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsList(s, Number(b.id)))) return NextResponse.json({ error: "العمود لا يتبع حسابك" }, { status: 403 });
  const data: { name?: string; position?: number } = {};
  if (typeof b.name === "string") data.name = b.name.trim();
  if (typeof b.position === "number") data.position = b.position;
  const updated = await prisma.taskList.update({ where: { id: Number(b.id) }, data });
  return NextResponse.json(updated);
}

// حذف عمود (وبطاقاته) حذفاً منطقياً
export async function DELETE(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsList(s, id))) return NextResponse.json({ error: "العمود لا يتبع حسابك" }, { status: 403 });
  await prisma.$transaction([
    prisma.taskCard.updateMany({ where: { listId: id }, data: { isDeleted: true } }),
    prisma.taskList.update({ where: { id }, data: { isDeleted: true } }),
  ]);
  return NextResponse.json({ ok: true });
}
