import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard } from "@/lib/cardsDistributor";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "all"; // transfer | payment | all
  const targetRaw = url.searchParams.get("targetAgentId");
  const targetAgentId = targetRaw != null && targetRaw !== "" ? Number(targetRaw) : NaN;
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const q = (url.searchParams.get("q") ?? "").trim();

  const from = baghdadStart(fromStr);
  const to = baghdadEnd(toStr);
  const at: Record<string, Date> = {};
  if (from) at.gte = from;
  if (to) at.lte = to;

  const baseWhere: Record<string, unknown> = { distributorId };
  if (Number.isFinite(targetAgentId)) baseWhere.targetAgentId = targetAgentId;
  if (Object.keys(at).length) baseWhere.createdAt = at;

  const rows: { kind: string; id: number; targetAgentId: number; amount: number; count: number | null; note: string | null; at: Date }[] = [];
  if (kind === "transfer" || kind === "all") {
    const tx = await prisma.distributorTransfer.findMany({ where: baseWhere, orderBy: { id: "desc" }, take: 500, select: { id: true, targetAgentId: true, total: true, count: true, note: true, createdAt: true } });
    for (const t of tx) rows.push({ kind: "transfer", id: t.id, targetAgentId: t.targetAgentId, amount: t.total, count: t.count, note: t.note, at: t.createdAt });
  }
  if (kind === "payment" || kind === "all") {
    const pay = await prisma.distributorPayment.findMany({ where: baseWhere, orderBy: { id: "desc" }, take: 500, select: { id: true, targetAgentId: true, amount: true, note: true, createdAt: true } });
    for (const p of pay) rows.push({ kind: "payment", id: p.id, targetAgentId: p.targetAgentId, amount: p.amount, count: null, note: p.note, at: p.createdAt });
  }

  const agentIds = [...new Set(rows.map((r) => r.targetAgentId))];
  const agents = agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  const aliasRows = await prisma.distributorTarget.findMany({ where: { distributorId, isDeleted: false }, select: { targetAgentId: true, alias: true } });
  const aliasById = new Map(aliasRows.filter((a) => a.alias && a.alias.trim()).map((a) => [a.targetAgentId, a.alias as string]));

  let out = rows.map((r) => ({ ...r, agentName: aliasById.get(r.targetAgentId) ?? nameById.get(r.targetAgentId) ?? `#${r.targetAgentId}` }));
  if (q) { const ql = q.toLowerCase(); out = out.filter((r) => (r.agentName ?? "").toLowerCase().includes(ql) || (r.note ?? "").toLowerCase().includes(ql)); }
  out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return NextResponse.json({ rows: out.slice(0, 500) });
}
