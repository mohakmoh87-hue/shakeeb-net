import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;

  const transfers = await prisma.distributorTransfer.findMany({
    where: { targetAgentId: agentId },
    orderBy: { id: "desc" },
    take: 300,
    select: { id: true, distributorId: true, targetPackageId: true, count: true, unitPrice: true, total: true, createdAt: true },
  });
  if (transfers.length === 0) return NextResponse.json({ rows: [] });

  const pkgIds = [...new Set(transfers.map((t) => t.targetPackageId).filter((x): x is number => x != null))];
  const distIds = [...new Set(transfers.map((t) => t.distributorId))];
  const [pkgs, dists] = await Promise.all([
    prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true } }),
    prisma.cardDistributor.findMany({ where: { id: { in: distIds } }, select: { id: true, distributorAgentId: true } }),
  ]);
  const pkgName = new Map(pkgs.map((p) => [p.id, p.name]));
  const distAgentId = new Map(dists.map((d) => [d.id, d.distributorAgentId]));
  const agentIds = [...new Set([...distAgentId.values()])];
  const agents = agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [];
  const agentName = new Map(agents.map((a) => [a.id, a.name]));

  const rows = transfers.map((t) => ({
    id: t.id,
    date: t.createdAt,
    count: t.count,
    unitPrice: t.unitPrice,
    total: t.total,
    packageName: pkgName.get(t.targetPackageId ?? -1) ?? null,
    distributorName: agentName.get(distAgentId.get(t.distributorId) ?? -1) ?? "الموزّع",
  }));
  return NextResponse.json({ rows });
}
