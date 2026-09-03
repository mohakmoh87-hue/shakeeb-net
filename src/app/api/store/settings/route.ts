import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

function feeOf(v: unknown): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1e13 ? BigInt(Math.round(n)) : null;
}

// رسومُ متجر الوكيل (توصيل/تنصيب × مشترك/غير مشترك) — ثابتةٌ على مستوى الوكيل.
export async function GET() {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { storeDeliverySub: true, storeInstallSub: true, storeDeliveryOther: true, storeInstallOther: true } });
  return NextResponse.json({
    deliverySub: priceToNum(a?.storeDeliverySub ?? null), installSub: priceToNum(a?.storeInstallSub ?? null),
    deliveryOther: priceToNum(a?.storeDeliveryOther ?? null), installOther: priceToNum(a?.storeInstallOther ?? null),
  });
}

export async function PATCH(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذه الجلسة" }, { status: 400 });
  const b = await request.json().catch(() => null);
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      storeDeliverySub: feeOf(b?.deliverySub), storeInstallSub: feeOf(b?.installSub),
      storeDeliveryOther: feeOf(b?.deliveryOther), storeInstallOther: feeOf(b?.installOther),
    },
  });
  return NextResponse.json({ ok: true });
}
