import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// إحصاء الكروت المتاحة/المستخدمة لكل فئة
export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const [packages, grouped] = await Promise.all([
    prisma.package.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, priceDinar: true },
      orderBy: { id: "asc" },
    }),
    prisma.rechargeCard.groupBy({
      by: ["packageId"],
      _count: { _all: true },
      where: { useDate: null },
    }),
  ]);

  const availMap = new Map(grouped.map((g) => [g.packageId, g._count._all]));

  return NextResponse.json(
    packages.map((p) => ({
      packageId: p.id,
      name: p.name,
      price: p.priceDinar,
      available: availMap.get(p.id) ?? 0,
    })),
  );
}
