import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { mailerConfigured, sendMail } from "@/lib/mailer";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// طلب استرجاع كلمة السر — عام: يُرسل رابط إعادة تعيين إلى إيميل الاسترجاع.
// إيميل الاسترجاع: للمالك recoveryEmail؛ للمدير recoveryEmail أو Agent.backupEmail.
export async function POST(request: Request) {
  if (!rateLimit(`forgot:${clientIp(request)}`, 5, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
  }
  const parsed = z.object({ username: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخل اسم المستخدم" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { username: parsed.data.username.trim() } });
  // رد عام دائماً (لا نكشف وجود المستخدم)
  const generic = NextResponse.json({ ok: true });
  if (!user || user.isDeleted) return generic;

  // تحديد إيميل الاسترجاع
  let email = user.recoveryEmail?.trim() || "";
  if (!email && user.agentId != null) {
    const agent = await prisma.agent.findUnique({ where: { id: user.agentId }, select: { backupEmail: true } });
    email = agent?.backupEmail?.trim() || "";
  }
  if (!email) return generic; // لا إيميل استرجاع مضبوط

  if (!mailerConfigured()) return generic; // خدمة البريد غير مفعّلة

  const token = crypto.randomBytes(24).toString("base64url");
  await prisma.user.update({ where: { id: user.id }, data: { resetToken: token, resetExpiry: new Date(Date.now() + 30 * 60 * 1000) } });

  const origin = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
  const link = `${origin}/reset?token=${token}`;
  await sendMail({
    to: email,
    subject: "استرجاع كلمة السر — شكيب نت",
    text: `طلبتَ إعادة تعيين كلمة سر حسابك (${user.username}).\n\nافتح هذا الرابط خلال 30 دقيقة لتعيين كلمة سر جديدة:\n${link}\n\nإن لم تطلب ذلك، تجاهل هذه الرسالة.`,
  });
  return generic;
}
