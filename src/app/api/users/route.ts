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

  // عزل المستأجر: المدير يرى مستخدمي وكيله فقط (ولا يرى مالك النظام)
  const users = await prisma.user.findMany({
    where: { isDeleted: false, isOwner: false, agentId: g.session?.agentId ?? -1 },
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

  // عزل المستأجر: المستخدم يُنشأ ضمن وكيل المدير، وأي مكتب مُسنَد يجب أن يتبع وكيله
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });
  const { permissions, password, ...rest } = parsed.data;
  if (rest.towerId != null) {
    const t = await prisma.tower.findFirst({ where: { id: rest.towerId, agentId, isDeleted: false }, select: { id: true } });
    if (!t) return NextResponse.json({ error: "المكتب المحدّد لا يتبع حسابك" }, { status: 403 });
  }
  const created = await prisma.user.create({
    data: {
      ...rest,
      agentId,
      password: await hashPassword(password),
      permissions: permissions.join(","),
    },
    select: { id: true, fullName: true, username: true, isAdmin: true, permissions: true, towerId: true, managerPhone: true, isActive: true },
  });
  return NextResponse.json(created, { status: 201 });
}
