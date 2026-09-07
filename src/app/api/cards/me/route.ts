import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard, getDistWaInfo, debtFor } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;

  const [tiers, targetsRaw, waInfo, stock] = await Promise.all([
    prisma.distributorTier.findMany({ where: { distributorId, isDeleted: false }, orderBy: { id: "asc" } }),
    prisma.distributorTarget.findMany({ where: { distributorId, isDeleted: false }, orderBy: { id: "asc" } }),
    getDistWaInfo(distributorId),
    prisma.distributorCard.groupBy({ by: ["tierId"], where: { distributorId, transferId: null, isDeleted: false }, _count: { _all: true } }),
  ]);

  const stockByTier: Record<string, number> = {};
  for (const s of stock) stockByTier[String(s.tierId ?? 0)] = s._count._all;
  const totalStock = Object.values(stockByTier).reduce((a, n) => a + n, 0);

  const agentIds = targetsRaw.map((t) => t.targetAgentId);
  const agents = agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  const agentStock = agentIds.length ? await prisma.rechargeCard.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, useDate: null }, _count: { _all: true } }) : [];
  const stockByAgent = new Map(agentStock.map((s) => [s.agentId, s._count._all]));
  const targets = await Promise.all(
    targetsRaw.map(async (t) => {
      const d = await debtFor(distributorId, t.targetAgentId);
      return { targetAgentId: t.targetAgentId, name: nameById.get(t.targetAgentId) ?? `#${t.targetAgentId}`, alias: t.alias ?? "", notifyPhone: t.notifyPhone ?? "", remaining: d.remaining, transferred: d.transferred, paid: d.paid, stock: stockByAgent.get(t.targetAgentId) ?? 0 };
    }),
  );

  return NextResponse.json({
    username: g.session.username,
    tiers: tiers.map((t) => ({ id: t.id, name: t.name, price: t.price, stock: stockByTier[String(t.id)] ?? 0 })),
    totalStock,
    targets,
    wa: waInfo,
  });
}
