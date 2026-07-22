import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { purgeSubscribers } from "@/lib/subscriberDelete";

const schema = z.object({
  name: z.string().min(1, "اسم المشترك مطلوب"),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  packageId: z.coerce.number().nullable().optional(),
  towerId: z.coerce.number().nullable().optional(),
  note: z.string().nullable().optional(),
  carry: z.coerce.number().nullable().optional(),
  wifiUser: z.string().nullable().optional(),
  wifiPass: z.string().nullable().optional(),
  netUser: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  affiliate: z.string().nullable().optional(),
  telegram: z.string().nullable().optional(),
  ftth: z.string().nullable().optional(),
  employee: z.string().nullable().optional(),
  subPassword: z.string().nullable().optional(),
  userNano: z.string().nullable().optional(),
  passNano: z.string().nullable().optional(),
  ipNano: z.string().nullable().optional(),
  waEnabled: z.boolean().optional(), // إرسال واتساب لهذا المشترك
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const subscriber = await prisma.subscriber.findUnique({
    where: { id: Number(id) },
  });
  if (!subscriber || !(await ownsTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }
  return NextResponse.json(subscriber);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("subscribers.manage");
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

  // منع تعديل مشترك مكتب آخر، ومنع إعادة تعيينه لمكتب آخر (لغير المدير)
  const existing = await prisma.subscriber.findUnique({
    where: { id: Number(id) },
    select: { towerId: true },
  });
  if (!existing || !(await ownsTower(g.session, existing.towerId))) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }
  // عزل المستأجر: مستخدم المكتب يُفرض مكتبه؛ والمدير لا يُسمح له بنقل المشترك إلا
  // لمكتب يتبع وكيله (يمنع نقله لمكتب وكيل آخر عبر towerId من الطلب).
  let data = parsed.data;
  if (g.session && !g.session.isAdmin && g.session.towerId != null) {
    data = { ...parsed.data, towerId: g.session.towerId };
  } else if (parsed.data.towerId != null) {
    const agentTowers = await agentTowerIds(g.session ?? null);
    if (!agentTowers.includes(parsed.data.towerId)) {
      return NextResponse.json({ error: "المكتب المحدّد لا يتبع حسابك" }, { status: 403 });
    }
  }

  const updated = await prisma.subscriber.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("subscribers.delete");
  if (g.error) return g.error;

  const { id } = await params;
  // منع حذف مشترك مكتب آخر
  const existing = await prisma.subscriber.findUnique({
    where: { id: Number(id) },
    select: { towerId: true },
  });
  if (!existing || !(await ownsTower(g.session, existing.towerId))) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }
  // حذف نهائي مع كل السجلات المرتبطة (وصولات/فواتير/حركات/رسائل)
  await purgeSubscribers([Number(id)]);
  return NextResponse.json({ ok: true });
}
