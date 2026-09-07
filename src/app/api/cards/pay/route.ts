import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard, allowedTarget, debtFor, notifyTargetPhone } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;

  const b = await request.json().catch(() => null);
  const targetAgentId = Number(b?.targetAgentId);
  const amount = Number(b?.amount);
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 300) : null;
  if (!Number.isFinite(targetAgentId) || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "بياناتٌ ناقصة" }, { status: 400 });
  if (!(await allowedTarget(distributorId, targetAgentId))) return NextResponse.json({ error: "هذا الوكيلُ ليس ضمن قائمتك" }, { status: 403 });

  await prisma.distributorPayment.create({ data: { distributorId, targetAgentId, amount, note } });
  const debt = await debtFor(distributorId, targetAgentId);
  const target = await prisma.distributorTarget.findFirst({ where: { distributorId, targetAgentId, isDeleted: false }, select: { notifyPhone: true } });
  notifyTargetPhone(distributorId, target?.notifyPhone, `تسديدُ كروت: ${amount.toLocaleString("en-US")}.\nالمتبقّي عليك: ${debt.remaining.toLocaleString("en-US")}.`);
  return NextResponse.json({ ok: true, remaining: debt.remaining });
}
