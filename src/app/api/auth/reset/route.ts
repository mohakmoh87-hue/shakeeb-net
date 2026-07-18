import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// إعادة تعيين كلمة السر برمز صالح لمرّة واحدة (30 دقيقة)
export async function POST(request: Request) {
  const parsed = z.object({ token: z.string().min(1), password: z.string().min(4, "كلمة السر 4 أحرف على الأقل") }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });

  const user = await prisma.user.findFirst({ where: { resetToken: parsed.data.token } });
  if (!user || !user.resetExpiry || user.resetExpiry.getTime() < Date.now()) {
    return NextResponse.json({ error: "الرابط غير صالح أو منتهي — اطلب استرجاعاً جديداً" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await hashPassword(parsed.data.password), plainPassword: parsed.data.password,
      resetToken: null, resetExpiry: null, failedAttempts: 0, lockedUntil: null,
    },
  });
  return NextResponse.json({ ok: true });
}
