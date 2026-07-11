import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, guardAny } from "@/lib/guard";

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
  silent: z.string().nullable().optional(), // 1 = إرسال صامت
  waEnabled: z.string().nullable().optional(), // 1 = تفعيل واتساب المكتب
  syncTime: z.string().nullable().optional(), // وقت مزامنة الاشتراكات اليومية (HH:MM)
  syncEnabled: z.string().nullable().optional(), // 1 = تفعيل المزامنة التلقائية
});

export async function GET() {
  // القراءة متاحة لإدارة المكاتب أو المشتركين (لقائمة المكاتب في صفحاتهم)
  const g = await guardAny("offices.manage", "subscribers.manage", "subscriptions.manage");
  if (g.error) return g.error;

  // كل مستخدم يرى مكتبه فقط (المكتب الذي id يساوي towerId له)، والأدمن يرى كل المكاتب
  const session = g.session;
  const ownFilter = session && !session.isAdmin && session.towerId != null ? { id: session.towerId } : {};
  const towers = await prisma.tower.findMany({
    where: { isDeleted: false, ...ownFilter },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(towers);
}

export async function POST(request: Request) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const created = await prisma.tower.create({ data: parsed.data });
  return NextResponse.json(created, { status: 201 });
}
