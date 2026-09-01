import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { encryptSecret } from "@/lib/secretbox";
import { getCompanySession, ensureCompanyUsersTable, newSessionToken } from "@/lib/companyAuth";

export const dynamic = "force-dynamic";

// عزل: المديرُ يعدّل/يحذف **موظفيه هو** فقط (parentId = معرّفه). لا يمسّ موظفَ مديرٍ آخر.
async function ownEmployee(managerId: number, id: number) {
  return prisma.companyUser.findFirst({ where: { id, role: "employee", parentId: managerId, isDeleted: false }, select: { id: true } });
}

const schema = z.object({ password: z.string().min(8, "كلمة المرور ٨ أحرف على الأقل") });

// تصفيرُ كلمة مرور موظف — يُبطل جلستَه فوراً (رمزٌ جديد لا null).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (s.role !== "manager") return NextResponse.json({ error: "للمدير فقط" }, { status: 403 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  await ensureCompanyUsersTable();
  if (!(await ownEmployee(s.companyUserId, Number(id)))) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.companyUser.update({
    where: { id: Number(id) },
    data: { password: await hashPassword(parsed.data.password), plainPassword: encryptSecret(parsed.data.password), sessionToken: newSessionToken() },
  });
  return NextResponse.json({ ok: true });
}

// حذفُ موظف (المدير حصراً) — حذفٌ ناعمٌ + إبطالُ الجلسة فوراً.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (s.role !== "manager") return NextResponse.json({ error: "للمدير فقط" }, { status: 403 });
  const { id } = await params;
  await ensureCompanyUsersTable();
  if (!(await ownEmployee(s.companyUserId, Number(id)))) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.companyUser.update({ where: { id: Number(id) }, data: { isDeleted: true, sessionToken: null } });
  return NextResponse.json({ ok: true });
}
