import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// جلب الكارت التالي المتاح لفئة معيّنة (بدون استهلاكه — يُستهلك عند التأكيد)
export async function GET(request: Request) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;

  const packageId = new URL(request.url).searchParams.get("packageId");
  if (!packageId) {
    return NextResponse.json({ error: "الفئة مطلوبة" }, { status: 400 });
  }

  const card = await prisma.rechargeCard.findFirst({
    where: { packageId: Number(packageId), useDate: null },
    orderBy: { id: "asc" },
    select: { id: true, serial: true },
  });

  const available = await prisma.rechargeCard.count({
    where: { packageId: Number(packageId), useDate: null },
  });

  return NextResponse.json({ card, available });
}
