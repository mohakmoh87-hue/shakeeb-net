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

  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    return NextResponse.json(
      { error: "اسم المستخدم أو كلمة السر غير صحيحة" },
      { status: 401 },
    );
  }

  await setSession({
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    permissions: (user.permissions ?? "").split(",").filter(Boolean) as Permission[],
    towerId: user.towerId ?? null,
  });

  // سجل تدقيق الدخول
  await prisma.auditLog.create({
    data: { userId: user.id, action: "LOGIN", entity: "user" },
  });

  return NextResponse.json({ ok: true });
}
