import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard, allowedTarget } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;
  const targetAgentId = Number(new URL(request.url).searchParams.get("targetAgentId"));
  if (!Number.isFinite(targetAgentId)) return NextResponse.json({ error: "حدّد الوكيل" }, { status: 400 });
  if (!(await allowedTarget(distributorId, targetAgentId))) return NextResponse.json({ error: "هذا الوكيلُ ليس ضمن قائمتك" }, { status: 403 });

  const packages = await prisma.package.findMany({
    where: { agentId: targetAgentId, isDeleted: false },
    orderBy: { id: "asc" },
    select: { id: true, name: true, priceDinar: true },
  });
  return NextResponse.json({ packages });
}
