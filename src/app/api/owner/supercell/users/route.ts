import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/secretbox";
import { ensureCompanyUsersTable, newSessionToken } from "@/lib/companyAuth";

export const dynamic = "force-dynamic";

// حساباتُ بوّابة سوبر سيل — يُديرها المالكُ حصراً (لا تسجيلَ ذاتيّ). طلبُ محمد 2026-08-29.
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;
  await ensureCompanyUsersTable();
  // المالكُ يُدير **المديرين** فقط — موظفو المديرين يُدارون من لوحة مديرهم (لا يختلطون هنا)
  const rows = await prisma.companyUser.findMany({
    where: { isDeleted: false, role: "manager" },
    select: { id: true, username: true, plainPassword: true, createdAt: true },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(rows.map((r) => ({ id: r.id, username: r.username, password: decryptSecret(r.plainPassword), createdAt: r.createdAt })));
}

const schema = z.object({
  username: z.string().min(3, "اسم المستخدم ٣ أحرف على الأقل").regex(/^[A-Za-z0-9._-]+$/, "أحرف إنجليزية وأرقام فقط"),
  // طرفٌ خارجيّ ⇒ حدٌّ أدنى أقوى (٨) لتقليل خطر التخمين
  password: z.string().min(8, "كلمة المرور ٨ أحرف على الأقل"),
});

export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { username, password } = parsed.data;
  await ensureCompanyUsersTable();
  const taken = await prisma.companyUser.findUnique({ where: { username }, select: { id: true, isDeleted: true } });
  if (taken && !taken.isDeleted) return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });
  if (taken && taken.isDeleted) {
    // إعادةُ تفعيل حسابٍ محذوفٍ بنفس اليوزر (لتفادي قيد التفرّد) — رمزٌ جديدٌ يُبطل أيَّ توكنٍ قديم.
    // ⚠️ يُعادُ ضبطُ role='manager'+parentId=null: لو كان اليوزرُ المحذوفُ **موظفاً** لمديرٍ سابق،
    // فالمالكُ ينشئ **مديراً** — فلا يُنتَج «مديرٌ» هو في الحقيقة موظفٌ منحدرٌ تابعٌ لمدير (اصطاده تدقيق).
    await prisma.companyUser.update({ where: { id: taken.id }, data: { password: await hashPassword(password), plainPassword: encryptSecret(password), isDeleted: false, sessionToken: newSessionToken(), role: "manager", parentId: null } });
  } else {
    await prisma.companyUser.create({ data: { username, password: await hashPassword(password), plainPassword: encryptSecret(password) } });
  }
  return NextResponse.json({ ok: true });
}
