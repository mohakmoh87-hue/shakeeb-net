import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { ensureAgentStoreTables, STORE_ORDER_STATES } from "@/lib/agentStore";
import { priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

// طلباتُ متجر الوكيل الواردة — معزولةٌ بـagentId (الوكيلِ البائع).
export async function GET(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentStoreTables();
  const status = (new URL(request.url).searchParams.get("status") ?? "").trim();
  const where: { agentId: number; status?: string } = { agentId };
  if (status && (STORE_ORDER_STATES as readonly string[]).includes(status)) where.status = status;
  const items = await prisma.storeOrder.findMany({ where, orderBy: { id: "desc" }, take: 200 });
  const counts = await prisma.storeOrder.groupBy({ by: ["status"], where: { agentId }, _count: true });
  return NextResponse.json({
    items: items.map((o) => ({ ...o, price: priceToNum(o.price) })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  });
}

export async function PATCH(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentStoreTables();
  const b = await request.json().catch(() => null);
  const id = Number(b?.id) || 0;
  const status = typeof b?.status === "string" ? b.status : "";
  if (!id || !(STORE_ORDER_STATES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }
  const own = await prisma.storeOrder.findFirst({ where: { id, agentId }, select: { id: true } });
  if (!own) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.storeOrder.update({ where: { id }, data: { status } });
  return NextResponse.json({ ok: true });
}
