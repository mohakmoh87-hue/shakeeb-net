import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// تسجيل ذاتي لتجربة أسبوع — عام (بلا دخول): ينشئ طلب وكيل تجريبي (بانتظار موافقة المالك).
const schema = z.object({
  fullName: z.string().min(1, "الاسم مطلوب"),
  username: z.string().min(3, "اسم المستخدم 3 أحرف على الأقل").regex(/^[A-Za-z0-9_.-]+$/, "أحرف إنجليزية وأرقام فقط"),
  password: z.string().min(4, "كلمة السر 4 أحرف على الأقل"),
});

export async function POST(request: Request) {
  if (!rateLimit(`trial:${clientIp(request)}`, 5, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { fullName, username, password } = parsed.data;

  // منع تكرار اسم المستخدم عبر كامل النظام
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return NextResponse.json({ error: "اسم المستخدم مستخدَم مسبقاً — اختر غيره" }, { status: 400 });

  const planExpiry = new Date(Date.now() + 7 * 24 * 3600 * 1000); // أسبوع

  // يُنشأ بانتظار الموافقة (approved=false، بلا دخول تلقائي) — يفعّله المالك من لوحته
  await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: { name: fullName, officeCap: 1, isTrial: true, approved: false, planExpiry },
    });
    await tx.user.create({
      data: {
        fullName, username, password: await hashPassword(password), plainPassword: password,
        role: "ADMIN", isAdmin: true, isOwner: false, agentId: agent.id, isActive: true,
      },
    });
  });

  return NextResponse.json({ ok: true, pending: true }, { status: 201 });
}
