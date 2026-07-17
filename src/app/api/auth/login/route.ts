import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, setSession } from "@/lib/auth";
import type { Permission } from "@/lib/rbac";

const schema = z.object({
  username: z.string().min(1, "اسم المستخدم مطلوب"),
  password: z.string().min(1, "كلمة السر مطلوبة"),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const { username, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || user.isDeleted || !user.isActive) {
    return NextResponse.json(
      { error: "اسم المستخدم أو كلمة السر غير صحيحة" },
      { status: 401 },
    );
  }

  // قفل مؤقّت بعد محاولات فاشلة كثيرة (منع التخمين)
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return NextResponse.json(
      { error: `الحساب مقفل مؤقتاً بسبب محاولات كثيرة — حاول بعد ${mins} دقيقة` },
      { status: 429 },
    );
  }

  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    // زيادة عدّاد الفشل، وقفل 15 دقيقة بعد 5 محاولات
    const attempts = (user.failedAttempts ?? 0) + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: attempts,
        lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      },
    });
    return NextResponse.json(
      { error: "اسم المستخدم أو كلمة السر غير صحيحة" },
      { status: 401 },
    );
  }

  // نجاح: تصفير عدّاد الفشل
  if (user.failedAttempts || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
  }

  // منع دخول وكيل منتهي الاشتراك (يبقى المالك ومستخدمو النظام بلا وكيل غير متأثّرين)
  if (!user.isOwner && user.agentId != null) {
    const agent = await prisma.agent.findUnique({ where: { id: user.agentId }, select: { planExpiry: true, isDeleted: true } });
    if (!agent || agent.isDeleted) {
      return NextResponse.json({ error: "الحساب غير مفعّل — تواصل مع الإدارة" }, { status: 403 });
    }
    if (agent.planExpiry && agent.planExpiry.getTime() < Date.now()) {
      return NextResponse.json({ error: "انتهت فترة اشتراكك — تواصل مع الإدارة للتجديد" }, { status: 403 });
    }
  }

  await setSession({
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    isOwner: user.isOwner,
    agentId: user.agentId ?? null,
    permissions: (user.permissions ?? "").split(",").filter(Boolean) as Permission[],
    towerId: user.towerId ?? null,
  });

  // سجل تدقيق الدخول
  await prisma.auditLog.create({
    data: { userId: user.id, action: "LOGIN", entity: "user" },
  });

  return NextResponse.json({ ok: true });
}
