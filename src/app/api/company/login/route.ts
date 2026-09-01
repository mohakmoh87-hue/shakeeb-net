import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { getPortalEnabled } from "@/lib/appConfig";
import { ensureCompanyUsersTable, setCompanySession, newSessionToken } from "@/lib/companyAuth";

export const dynamic = "force-dynamic";

// دخولُ بوّابة سوبر سيل (الشركة) — كودٌ جديدٌ منفصلٌ لا يمسّ /api/auth/login. الحسابُ يُنشئه
// المالكُ حصراً. مغلقٌ إن أطفأ المالكُ البوّابة. جلسةٌ منفصلةٌ (kabina_company).
const DUMMY_HASH = bcrypt.hashSync("company-login-dummy", 10); // لتثبيت زمن الردّ عند غياب اليوزر
const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function POST(request: Request) {
  // تحديدُ المعدّل ضدّ التخمين (نفسُ طبقتَي دخول المستخدم): IP ثمّ حساب
  if (!rateLimit(`company-login-ip:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
  }
  if (!(await getPortalEnabled())) return NextResponse.json({ error: "البوّابة مغلقة حالياً" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخل اسم المستخدم وكلمة المرور" }, { status: 400 });
  const { username, password } = parsed.data;
  if (!rateLimit(`company-login-user:${username.trim().toLowerCase()}`, 10, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة على هذا الحساب — انتظر دقيقة" }, { status: 429 });
  }

  await ensureCompanyUsersTable();
  const u = await prisma.companyUser.findUnique({ where: { username } });
  // تحقّقٌ دائمٌ (حتى بلا مستخدم) بزمنٍ متقاربٍ كي لا يُكشَف وجودُ اليوزر بالتوقيت
  const ok = await verifyPassword(password, u && !u.isDeleted ? u.password : DUMMY_HASH);
  if (!u || u.isDeleted || !ok) return NextResponse.json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });

  // موظفٌ يتيمٌ (بلا مديرٍ أو حُذف مديرُه) لا يدخل — يُوحَّد مع فحص getCompanySession فلا يدخلُ ثمّ تُبطَل جلستُه
  if (u.role === "employee") {
    if (u.parentId == null) return NextResponse.json({ error: "الحسابُ غيرُ نشط — راجِع مديرَك" }, { status: 403 });
    const parent = await prisma.companyUser.findUnique({ where: { id: u.parentId }, select: { isDeleted: true } });
    if (!parent || parent.isDeleted) return NextResponse.json({ error: "الحسابُ غيرُ نشط — راجِع مديرَك" }, { status: 403 });
  }
  const st = newSessionToken();
  await prisma.companyUser.update({ where: { id: u.id }, data: { sessionToken: st } });
  await setCompanySession({
    kind: "company", companyUserId: u.id, username: u.username,
    role: u.role === "employee" ? "employee" : "manager", parentId: u.parentId ?? null, sessionToken: st,
  });
  return NextResponse.json({ ok: true, role: u.role === "employee" ? "employee" : "manager" });
}
