import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

async function auth() {
  const s = await getSession();
  return s ? null : NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
}

// إنشاء عمود جديد في اللوحة
export async function POST(request: Request) {
  const e = await auth(); if (e) return e;
  const b = await request.json().catch(() => null);
  if (!b?.boardId || !b?.name?.trim()) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  const count = await prisma.taskList.count({ where: { boardId: Number(b.boardId), isDeleted: false } });
  const created = await prisma.taskList.create({ data: { boardId: Number(b.boardId), name: String(b.name).trim(), position: count } });
  return NextResponse.json(created, { status: 201 });
}

// تعديل عمود (الاسم/الترتيب)
export async function PATCH(request: Request) {
  const e = await auth(); if (e) return e;
  const b = await request.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const data: { name?: string; position?: number } = {};
  if (typeof b.name === "string") data.name = b.name.trim();
  if (typeof b.position === "number") data.position = b.position;
  const updated = await prisma.taskList.update({ where: { id: Number(b.id) }, data });
  return NextResponse.json(updated);
}

// حذف عمود (وبطاقاته) حذفاً منطقياً
export async function DELETE(request: Request) {
  const e = await auth(); if (e) return e;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  await prisma.$transaction([
    prisma.taskCard.updateMany({ where: { listId: id }, data: { isDeleted: true } }),
    prisma.taskList.update({ where: { id }, data: { isDeleted: true } }),
  ]);
  return NextResponse.json({ ok: true });
}
