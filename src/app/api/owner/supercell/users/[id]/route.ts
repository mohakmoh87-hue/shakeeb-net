import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { encryptSecret } from "@/lib/secretbox";
import { ensureCompanyUsersTable, newSessionToken } from "@/lib/companyAuth";

export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(4, "كلمة المرور ٤ أحرف على الأقل") });

// تصفيرُ كلمة مرور حساب شركة (المالك حصراً) — يُبطل جلستَه الحاليّة **فوراً**: نُدوّر رمزَ
// الجهاز (newSessionToken) لا نضعه null، وإلّا تخطّى getCompanySession الفحصَ وبقيَ التوكنُ القديمُ صالحاً.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  await ensureCompanyUsersTable();
  await prisma.companyUser.update({
    where: { id: Number(id) },
    data: { password: await hashPassword(parsed.data.password), plainPassword: encryptSecret(parsed.data.password), sessionToken: newSessionToken() },
  });
  return NextResponse.json({ ok: true });
}

// حذفُ حساب شركة (المالك حصراً) — حذفٌ ناعمٌ + إبطالُ الجلسة فوراً (getCompanySession يردّ null).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const { id } = await params;
  await ensureCompanyUsersTable();
  await prisma.companyUser.update({ where: { id: Number(id) }, data: { isDeleted: true, sessionToken: null } });
  return NextResponse.json({ ok: true });
}
