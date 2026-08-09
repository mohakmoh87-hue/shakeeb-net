import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { agentOwnsBoard, agentOwnsList, canOperateList } from "@/lib/field";
import { ensureCardType } from "@/lib/fieldDefaults";

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
  // ربطٌ تلقائيّ: إنشاء عمودٍ جديد يُنشئ نوعه في «الأنواع والأوقات» بنفس الاسم (يتخطّى النظاميّة)
  await ensureCardType(g.session?.agentId ?? null, created.name);
  return NextResponse.json(created, { status: 201 });
}

// تعديل عمود (الاسم/الترتيب/محسوب بالوقت)
// ===== تحريك الأعمدة للمدير **وللمستخدم** (طلب محمد 2026-08-09) =====
// كان المسار كلّه بصلاحيّة field.manage، فسحبُ مستخدم المكتب للعمود يفشل بصمت (العميل
// يتجاهل الخطأ) ويعود الترتيب عند أوّل تحديث. الآن: **تحريك الترتيب** يجوز لمن يكتب على
// مكتب العمود (المدير على مكاتب وكيله، ومستخدم المكتب على مكتبه — نفس قاعدة سحب البطاقات)،
// أمّا **التسمية وخاصيّة «محسوب بالوقت»** فتبقى للمدير (field.manage) كما هي.
export async function PATCH(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const listId = Number(b.id);
  // عزل الوكيل ثمّ عزل المكتب (الكتابة على مكتب العمود)
  if (!(await agentOwnsList(s, listId))) return NextResponse.json({ error: "العمود لا يتبع حسابك" }, { status: 403 });
  if (!(await canOperateList(s, listId))) {
    return NextResponse.json({ error: "مشاهدة فقط — لا يمكنك التعديل على مكتب آخر" }, { status: 403 });
  }
  const wantsName = typeof b.name === "string";
  const wantsTime = typeof b.timeTracked === "boolean";
  if ((wantsName || wantsTime) && !can(s, "field.manage")) {
    return NextResponse.json({ error: "تسمية الأعمدة وخصائصها للمدير — أمّا ترتيبها فمتاحٌ لك" }, { status: 403 });
  }
  const data: { name?: string; position?: number; timeTracked?: boolean } = {};
  if (wantsName) data.name = b.name.trim();
  if (typeof b.position === "number") data.position = b.position;
  if (wantsTime) data.timeTracked = b.timeTracked;
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
