import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// أسعار الكارت لكل فئة (باقة) — يُطبَّق تلقائياً عند إضافة كروت الفئة
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const packages = await prisma.package.findMany({
    where: { isDeleted: false, agentId: session.agentId ?? -1 }, // عزل: باقات وكيل المستخدم فقط
    select: { id: true, name: true, priceDinar: true, cardCost: true },
    orderBy: { id: "asc" },
  });
  const canEdit = session.isAdmin; // سعر الكارت للمدير حصراً (قرار محمد: «يغيّر من مجموع ديون الكارتات»)
  return NextResponse.json({ packages, canEdit });
}

// تحديد سعر كارت فئة محدّدة (للمدير حصراً — بلا صلاحية) — يشمل الكروت الجديدة فقط
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (!s.isAdmin) return NextResponse.json({ error: "سعر الكارت للمدير حصراً" }, { status: 403 });
  const g = { session: s };
  const body = await request.json().catch(() => null);
  const parsed = z.object({ packageId: z.coerce.number(), price: z.coerce.number().min(0) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  // عزل المستأجر: لا يُعدَّل إلا سعر باقة تتبع وكيل المستخدم
  const pkg = await prisma.package.findFirst({ where: { id: parsed.data.packageId, agentId: g.session?.agentId ?? -1 } });
  if (!pkg) return NextResponse.json({ error: "الباقة غير موجودة" }, { status: 404 });

  await prisma.package.update({ where: { id: parsed.data.packageId }, data: { cardCost: parsed.data.price } });
  return NextResponse.json({ ok: true });
}
