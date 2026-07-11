import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";

const schema = z.object({
  fullName: z.string().min(1, "الاسم الكامل مطلوب"),
  username: z.string().min(1, "اسم المستخدم مطلوب"),
  password: z.string().min(4, "كلمة السر 4 أحرف على الأقل"),
  isAdmin: z.coerce.boolean().default(false),
  permissions: z.array(z.string()).default([]),
  towerId: z.coerce.number().nullable().optional(),
  managerPhone: z.string().nullable().optional(),
  isActive: z.coerce.boolean().default(true),
});

export async function GET() {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const users = await prisma.user.findMany({
    where: { isDeleted: false },
    orderBy: { id: "asc" },
    select: {
      id: true, fullName: true, username: true, isAdmin: true,
      permissions: true, towerId: true, managerPhone: true, isActive: true,
    },
  });
  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const exists = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (exists) {
    return NextResponse.json({ error: "اسم المستخدم موجود مسبقاً" }, { status: 400 });
  }

  const { permissions, password, ...rest } = parsed.data;
  const created = await prisma.user.create({
    data: {
      ...rest,
      password: await hashPassword(password),
      permissions: permissions.join(","),
    },
    select: { id: true, fullName: true, username: true, isAdmin: true, permissions: true, towerId: true, managerPhone: true, isActive: true },
  });
  return NextResponse.json(created, { status: 201 });
}
