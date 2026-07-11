import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

async function auth() {
  const s = await getSession();
  return s ? null : NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
}

// إنشاء بطاقة جديدة في عمود
export async function POST(request: Request) {
  const e = await auth(); if (e) return e;
  const b = await request.json().catch(() => null);
  if (!b?.listId || !b?.title?.trim()) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  const count = await prisma.taskCard.count({ where: { listId: Number(b.listId), isDeleted: false } });
  const created = await prisma.taskCard.create({
    data: { listId: Number(b.listId), title: String(b.title).trim(), position: count },
  });
  return NextResponse.json(created, { status: 201 });
}

// تعديل بطاقة (المحتوى أو النقل بين الأعمدة/الترتيب)
export async function PATCH(request: Request) {
  const e = await auth(); if (e) return e;
  const b = await request.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (typeof b.title === "string") data.title = b.title.trim();
  if ("description" in b) data.description = b.description || null;
  if ("assignee" in b) data.assignee = b.assignee || null;
  if ("label" in b) data.label = b.label || null;
  if ("dueDate" in b) data.dueDate = b.dueDate ? new Date(b.dueDate) : null;
  if (typeof b.listId === "number") data.listId = b.listId;
  if (typeof b.position === "number") data.position = b.position;
  if (typeof b.done === "boolean") data.done = b.done;
  const updated = await prisma.taskCard.update({ where: { id: Number(b.id) }, data });
  return NextResponse.json(updated);
}

// حذف بطاقة حذفاً منطقياً
export async function DELETE(request: Request) {
  const e = await auth(); if (e) return e;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  await prisma.taskCard.update({ where: { id }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
