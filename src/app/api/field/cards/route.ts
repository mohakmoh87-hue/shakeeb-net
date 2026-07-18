import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentOwnsCard, agentOwnsList } from "@/lib/field";

// إنشاء بطاقة جديدة في عمود — مع خياراتها مباشرةً (فني، تاريخ، نوع، وصف)
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.listId || !b?.title?.trim()) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  if (!(await agentOwnsList(s, Number(b.listId)))) return NextResponse.json({ error: "العمود لا يتبع حسابك" }, { status: 403 });
  const count = await prisma.taskCard.count({ where: { listId: Number(b.listId), isDeleted: false } });
  const created = await prisma.taskCard.create({
    data: {
      listId: Number(b.listId),
      title: String(b.title).trim(),
      position: count,
      // نوع البطاقة = اسم الفئة (CardType) كما اختاره المستخدم — لا يُقسَر إلى maintenance/delivery
      kind: b.kind ? String(b.kind).trim() : "صيانة",
      assignee: b.assignee ? String(b.assignee) : null,
      technicianId: b.technicianId != null ? Number(b.technicianId) : null,
      dueDate: b.dueDate ? new Date(b.dueDate) : null,
      description: b.description ? String(b.description) : null,
      label: b.label ? String(b.label) : null,
    },
  });
  return NextResponse.json(created, { status: 201 });
}

// تعديل بطاقة (المحتوى أو النقل بين الأعمدة/الترتيب)
export async function PATCH(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsCard(s, Number(b.id)))) return NextResponse.json({ error: "البطاقة لا تتبع حسابك" }, { status: 403 });
  // عند النقل لعمود آخر: تحقّق أن العمود الهدف يتبع الوكيل أيضاً
  if (typeof b.listId === "number" && !(await agentOwnsList(s, b.listId))) return NextResponse.json({ error: "العمود الهدف لا يتبع حسابك" }, { status: 403 });
  const data: Record<string, unknown> = {};
  if (typeof b.title === "string") data.title = b.title.trim();
  if ("description" in b) data.description = b.description || null;
  if ("assignee" in b) data.assignee = b.assignee || null;
  if ("technicianId" in b) data.technicianId = b.technicianId != null ? Number(b.technicianId) : null;
  if ("kind" in b && b.kind) data.kind = String(b.kind).trim();
  if ("label" in b) data.label = b.label || null;
  if ("dueDate" in b) data.dueDate = b.dueDate ? new Date(b.dueDate) : null;
  if (typeof b.listId === "number") data.listId = b.listId;
  if (typeof b.position === "number") data.position = b.position;
  // ملاحظة: الإنجاز (done=true) يتمّ عبر /api/field/complete فقط (بحقوله الواجبة)
  if (b.done === false) { data.done = false; data.completedAt = null; }
  const updated = await prisma.taskCard.update({ where: { id: Number(b.id) }, data });
  return NextResponse.json(updated);
}

// حذف بطاقة حذفاً منطقياً — مع حذف صورتها فعلياً من القاعدة (تفريغ مساحة الاستضافة)
export async function DELETE(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsCard(s, id))) return NextResponse.json({ error: "البطاقة لا تتبع حسابك" }, { status: 403 });
  await prisma.taskCard.update({ where: { id }, data: { isDeleted: true } });
  await prisma.cardPhoto.deleteMany({ where: { cardId: id } });
  return NextResponse.json({ ok: true });
}
