import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cardsGuard } from "@/lib/cardsDistributor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const g = await cardsGuard();
  if ("error" in g) return g.error;
  const distributorId = g.session.distributorId;
  const b = await request.json().catch(() => null);
  const targetAgentId = Number(b?.targetAgentId);
  const notifyPhone = typeof b?.notifyPhone === "string" ? b.notifyPhone.trim().slice(0, 20) : "";
  if (!Number.isFinite(targetAgentId)) return NextResponse.json({ error: "حدّد الوكيل" }, { status: 400 });
  const t = await prisma.distributorTarget.findFirst({ where: { distributorId, targetAgentId, isDeleted: false }, select: { id: true } });
  if (!t) return NextResponse.json({ error: "هذا الوكيلُ ليس ضمن قائمتك" }, { status: 403 });
  await prisma.distributorTarget.update({ where: { id: t.id }, data: { notifyPhone: notifyPhone || null } });
  return NextResponse.json({ ok: true });
}
