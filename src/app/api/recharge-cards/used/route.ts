import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// الكروت المستخدمة مع المشترك الذي فُعّل له والتاريخ والساعة
export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const cards = await prisma.rechargeCard.findMany({
    where: { useDate: { not: null } },
    orderBy: { useDate: "desc" },
    take: 1000,
  });

  const [subs, packages] = await Promise.all([
    prisma.subscriber.findMany({
      where: { id: { in: cards.map((c) => c.subscriberId).filter(Boolean) as number[] } },
      select: { id: true, name: true },
    }),
    prisma.package.findMany({ select: { id: true, name: true } }),
  ]);
  const subMap = new Map(subs.map((s) => [s.id, s.name]));
  const pkgMap = new Map(packages.map((p) => [p.id, p.name]));

  return NextResponse.json(
    cards.map((c) => ({
      id: c.id,
      serial: c.serial,
      packageName: c.packageId ? pkgMap.get(c.packageId) ?? null : null,
      subscriber: c.subscriberId ? subMap.get(c.subscriberId) ?? null : null,
      useDate: c.useDate,
      userName: c.userName,
    })),
  );
}
