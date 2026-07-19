import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// تسجيل رمز جهاز FCM للمستخدم (مدير/موظف) من التطبيق الأصلي — لإشعارات الهاتف
// حين لا يدعم WebView الأصلي Web Push. العزل: المستخدم يعدّل صفّه فقط.
const schema = z.object({ token: z.string().min(10).max(4096).nullable() });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "رمز غير صحيح" }, { status: 400 });
  await prisma.user.update({ where: { id: session.userId }, data: { fcmToken: parsed.data.token } });
  return NextResponse.json({ ok: true });
}
