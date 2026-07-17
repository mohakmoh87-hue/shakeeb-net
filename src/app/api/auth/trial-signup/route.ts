import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSession } from "@/lib/auth";
import type { Permission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// تسجيل ذاتي لتجربة أسبوع — عام (بلا دخول): ينشئ وكيلاً تجريبياً بمكتب واحد ينتهي بعد 7 أيام.
const schema = z.object({
  fullName: z.string().min(1, "الاسم مطلوب"),
  username: z.string().min(3, "اسم المستخدم 3 أحرف على الأقل").regex(/^[A-Za-z0-9_.-]+$/, "أحرف إنجليزية وأرقام فقط"),
  password: z.string().min(4, "كلمة السر 4 أحرف على الأقل"),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { fullName, username, password } = parsed.data;

  // منع تكرار اسم المستخدم عبر كامل النظام
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return NextResponse.json({ error: "اسم المستخدم مستخدَم مسبقاً — اختر غيره" }, { status: 400 });

  const planExpiry = new Date(Date.now() + 7 * 24 * 3600 * 1000); // أسبوع

  const created = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: { name: fullName, officeCap: 1, isTrial: true, planExpiry },
    });
    const manager = await tx.user.create({
      data: {
        fullName, username, password: await hashPassword(password),
        role: "ADMIN", isAdmin: true, isOwner: false, agentId: agent.id, isActive: true,
      },
    });
    return { agent, manager };
  });

  // تسجيل دخول تلقائي للحساب الجديد
  await setSession({
    userId: created.manager.id,
    username: created.manager.username,
    fullName: created.manager.fullName,
    isAdmin: true,
    isOwner: false,
    agentId: created.agent.id,
    permissions: [] as Permission[],
    towerId: null,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
