import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { ensureAgentStoreTables, STORE_ORDER_STATES } from "@/lib/agentStore";
import { priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

// عمودُ «طلبات المتجر» في إدارة الفنيين — طلباتُ متجر الوكيل الواصلةُ له (معزولةٌ بـagentId البائع).
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ orders: [] });
  await ensureAgentStoreTables();
  // الطلباتُ الفاعلةُ فقط (new/accepted) فيختفي العمودُ حين تُنجَز كلُّها (طلب محمد)
  const orders = await prisma.storeOrder.findMany({ where: { agentId, status: { in: ["new", "accepted"] } }, orderBy: { id: "desc" }, take: 200 });
  return NextResponse.json({ orders: orders.map((o) => ({ ...o, price: priceToNum(o.price) })) });
}

export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "ليس لديك وكيل" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id) || 0;
  const status = typeof body?.status === "string" ? body.status : "";
  if (!id || !(STORE_ORDER_STATES as readonly string[]).includes(status)) return NextResponse.json({ error: "طلبٌ غير صالح" }, { status: 400 });
  await ensureAgentStoreTables();
  const own = await prisma.storeOrder.updateMany({ where: { id, agentId }, data: { status } });
  if (own.count === 0) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
