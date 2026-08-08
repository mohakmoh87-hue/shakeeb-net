import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// إحصاء الكروت المتاحة/المستخدمة لكل فئة
export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const agentId = g.session?.agentId ?? -1; // عزل: باقات وكروت وكيل المستخدم فقط
  const [packages, grouped] = await Promise.all([
    prisma.package.findMany({
      where: { isDeleted: false, agentId },
      select: { id: true, name: true, priceDinar: true, cardCost: true },
      orderBy: { id: "asc" },
    }),
    prisma.rechargeCard.groupBy({
      by: ["packageId"],
      _count: { _all: true },
      _sum: { price: true }, // مجموع أسعار الكروت المتاحة (السعر الفعليّ المخزَّن لكل كارت)
      where: { useDate: null, agentId },
    }),
  ]);

  const availMap = new Map(grouped.map((g) => [g.packageId, { count: g._count._all, amount: g._sum.price ?? 0 }]));

  return NextResponse.json(
    packages.map((p) => ({
      packageId: p.id,
      name: p.name,
      price: p.priceDinar,
      cardCost: p.cardCost ?? 0, // سعر الكارت الفعليّ المحدَّد في حسابات المدير
      available: availMap.get(p.id)?.count ?? 0,
      amount: availMap.get(p.id)?.amount ?? 0, // مجموع مبلغ كروت هذه الفئة المتاحة
    })),
  );
}
