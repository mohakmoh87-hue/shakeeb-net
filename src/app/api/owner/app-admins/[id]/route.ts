import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { encryptSecret } from "@/lib/secretbox";
import { ensureAppAdminsTable, newSessionToken } from "@/lib/appAdminAuth";

export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(8, "كلمة المرور ٨ أحرف على الأقل") });

// تصفيرُ كلمة مرور أدمن التطبيق (المالك حصراً) — يُبطل جلستَه فوراً: نُدوّر رمزَ الجهاز لا null.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  await ensureAppAdminsTable();
  await prisma.appAdmin.update({
    where: { id: Number(id) },
    data: { password: await hashPassword(parsed.data.password), plainPassword: encryptSecret(parsed.data.password), sessionToken: newSessionToken() },
  });
  return NextResponse.json({ ok: true });
}

// حذفُ أدمن التطبيق (المالك حصراً) — حذفٌ ناعمٌ + إبطالُ الجلسة فوراً.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const { id } = await params;
  await ensureAppAdminsTable();
  await prisma.appAdmin.update({ where: { id: Number(id) }, data: { isDeleted: true, sessionToken: null } });
  return NextResponse.json({ ok: true });
}
