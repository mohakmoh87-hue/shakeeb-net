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
  if (!Number.isFinite(targetAgentId)) return NextResponse.json({ error: "حدّد الوكيل" }, { status: 400 });
  const t = await prisma.distributorTarget.findFirst({ where: { distributorId, targetAgentId, isDeleted: false }, select: { id: true } });
  if (!t) return NextResponse.json({ error: "هذا الوكيلُ ليس ضمن قائمتك" }, { status: 403 });

  const data: { notifyPhone?: string | null; alias?: string | null } = {};
  if (typeof b?.notifyPhone === "string") { const p = b.notifyPhone.trim().slice(0, 20); data.notifyPhone = p || null; }
  if (typeof b?.alias === "string") { const a = b.alias.trim().slice(0, 60); data.alias = a || null; }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  await prisma.distributorTarget.update({ where: { id: t.id }, data });
  return NextResponse.json({ ok: true });
}
