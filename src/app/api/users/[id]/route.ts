import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";

const schema = z.object({
  fullName: z.string().min(1, "الاسم الكامل مطلوب"),
  username: z.string().min(1, "اسم المستخدم مطلوب"),
  password: z.string().optional(), // فارغ = عدم التغيير
  isAdmin: z.coerce.boolean().default(false),
  permissions: z.array(z.string()).default([]),
  towerId: z.coerce.number().nullable().optional(),
  managerPhone: z.string().nullable().optional(),
  isActive: z.coerce.boolean().default(true),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { password, permissions, ...rest } = parsed.data;

  const updated = await prisma.user.update({
    where: { id: Number(id) },
    data: {
      ...rest,
      permissions: permissions.join(","),
      ...(password && password.length >= 4 ? { password: await hashPassword(password) } : {}),
    },
    select: { id: true, fullName: true, username: true, isAdmin: true, permissions: true, towerId: true, managerPhone: true, isActive: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const uid = Number(id);
  if (uid === g.session?.userId) {
    return NextResponse.json({ error: "لا يمكنك حذف حسابك الحالي" }, { status: 400 });
  }
  // حذف نهائي من قاعدة البيانات (لإمكانية إعادة إضافة نفس اليوزر لاحقاً)
  await prisma.$transaction([
    prisma.auditLog.updateMany({ where: { userId: uid }, data: { userId: null } }),
    prisma.user.delete({ where: { id: uid } }),
  ]);
  return NextResponse.json({ ok: true });
}
