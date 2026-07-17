import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({
  name: z.string().min(1, "اسم المكتب مطلوب"),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  loginUrl: z.string().nullable().optional(),
  activationTemplate: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  price: z.coerce.number().nullable().optional(),
  nesba: z.coerce.number().nullable().optional(),
  groupId: z.coerce.number().nullable().optional(),
  activationMode: z.enum(["month", "days30"]).nullable().optional(), // نظام التفعيل
  managerPhone: z.string().nullable().optional(), // رقم مدير المكتب
  mapArea: z.string().nullable().optional(), // رمز منطقة الخريطة
  rewardsEnabled: z.string().nullable().optional(), // 1 = تفعيل نظام المكافآت للمكتب
  silent: z.string().nullable().optional(), // 1 = إرسال صامت
  waEnabled: z.string().nullable().optional(), // 1 = تفعيل واتساب المكتب
  syncTime: z.string().nullable().optional(), // وقت مزامنة الاشتراكات اليومية (HH:MM)
  syncEnabled: z.string().nullable().optional(), // 1 = تفعيل المزامنة التلقائية
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("offices.manage");
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

  const updated = await prisma.tower.update({
    where: { id: Number(id) },
    data: parsed.data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;

  const { id } = await params;
  await prisma.tower.update({
    where: { id: Number(id) },
    data: { isDeleted: true },
  });
  return NextResponse.json({ ok: true });
}
