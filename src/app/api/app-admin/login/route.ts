import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { ensureAppAdminsTable, setAppAdminSession, newSessionToken } from "@/lib/appAdminAuth";

export const dynamic = "force-dynamic";

// دخولُ أدمن تطبيق المشترك — كودٌ منفصلٌ لا يمسّ /api/auth/login ولا /api/company/login.
// الحسابُ يُنشئه المالكُ حصراً. جلسةٌ منفصلةٌ (kabina_appadmin).
const DUMMY_HASH = bcrypt.hashSync("app-admin-login-dummy", 10); // لتثبيت زمن الردّ عند غياب اليوزر
const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function POST(request: Request) {
  // تحديدُ المعدّل ضدّ التخمين: IP ثمّ حساب
  if (!rateLimit(`appadmin-login-ip:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخل اسم المستخدم وكلمة المرور" }, { status: 400 });
  const { username, password } = parsed.data;
  if (!rateLimit(`appadmin-login-user:${username.trim().toLowerCase()}`, 10, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة على هذا الحساب — انتظر دقيقة" }, { status: 429 });
  }

  await ensureAppAdminsTable();
  const u = await prisma.appAdmin.findUnique({ where: { username } });
  // تحقّقٌ دائمٌ (حتى بلا مستخدم) بزمنٍ متقاربٍ كي لا يُكشَف وجودُ اليوزر بالتوقيت
  const ok = await verifyPassword(password, u && !u.isDeleted ? u.password : DUMMY_HASH);
  if (!u || u.isDeleted || !ok) return NextResponse.json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });

  const st = newSessionToken();
  await prisma.appAdmin.update({ where: { id: u.id }, data: { sessionToken: st } });
  await setAppAdminSession({ kind: "appadmin", appAdminId: u.id, username: u.username, sessionToken: st });
  return NextResponse.json({ ok: true });
}
