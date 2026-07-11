import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// أسعار الكارت لكل فئة (باقة) — يُطبَّق تلقائياً عند إضافة كروت الفئة
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const packages = await prisma.package.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true, priceDinar: true, cardCost: true },
    orderBy: { id: "asc" },
  });
  const canEdit = session.isAdmin || (session.permissions ?? []).includes("cardprice.manage");
  return NextResponse.json({ packages, canEdit });
}

// تحديد سعر كارت فئة محدّدة (صلاحية cardprice.manage) — يشمل الكروت الجديدة فقط
export async function POST(request: Request) {
  const g = await guard("cardprice.manage");
  if (g.error) return g.error;
  const body = await request.json().catch(() => null);
  const parsed = z.object({ packageId: z.coerce.number(), price: z.coerce.number().min(0) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  await prisma.package.update({ where: { id: parsed.data.packageId }, data: { cardCost: parsed.data.price } });
  return NextResponse.json({ ok: true });
}
