import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard, allowedTarget, debtFor } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;
  const targetAgentId = Number(new URL(request.url).searchParams.get("targetAgentId"));
  if (!Number.isFinite(targetAgentId)) return NextResponse.json({ error: "حدّد الوكيل" }, { status: 400 });
  if (!(await allowedTarget(distributorId, targetAgentId))) return NextResponse.json({ error: "هذا الوكيلُ ليس ضمن قائمتك" }, { status: 403 });

  const [transfers, payments, debt] = await Promise.all([
    prisma.distributorTransfer.findMany({ where: { distributorId, targetAgentId }, orderBy: { id: "desc" }, take: 300, select: { id: true, count: true, unitPrice: true, total: true, note: true, createdAt: true } }),
    prisma.distributorPayment.findMany({ where: { distributorId, targetAgentId }, orderBy: { id: "desc" }, take: 300, select: { id: true, amount: true, note: true, createdAt: true } }),
    debtFor(distributorId, targetAgentId),
  ]);

  const ledger = [
    ...transfers.map((t) => ({ kind: "transfer" as const, id: t.id, amount: t.total, count: t.count, unitPrice: t.unitPrice, note: t.note, at: t.createdAt })),
    ...payments.map((p) => ({ kind: "payment" as const, id: p.id, amount: p.amount, count: null, unitPrice: null, note: p.note, at: p.createdAt })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return NextResponse.json({ debt, ledger });
}
