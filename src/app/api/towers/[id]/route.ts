import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";

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
  reminderTime: z.string().nullable().optional(), // وقت تذكير الانتهاء الخاص بهذا المكتب (HH:MM)
  // موقع المكتب للبصمة الجغرافية
  lat: z.coerce.number().nullable().optional(),
  lng: z.coerce.number().nullable().optional(),
  geoRadius: z.coerce.number().int().min(20).max(5000).nullable().optional(),
  geoEnabled: z.boolean().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;

  const { id } = await params;
  // عزل المستأجر: لا يُعدَّل إلا مكتب يتبع وكيل المستخدم
  if (!(await ownsTower(g.session, Number(id)))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }
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
  // عزل المستأجر: لا يُحذف إلا مكتب يتبع وكيل المستخدم
  if (!(await ownsTower(g.session, Number(id)))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }
  await prisma.tower.update({
    where: { id: Number(id) },
    data: { isDeleted: true },
  });
  return NextResponse.json({ ok: true });
}
