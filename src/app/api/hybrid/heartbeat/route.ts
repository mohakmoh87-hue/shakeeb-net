import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeLeaderMachineId } from "@/lib/hybridLeader";

export const dynamic = "force-dynamic";

// نبضة العامل المحلي: يسجّل الحاسبة/يحدّث آخر ظهور، ويعيد هل هي القائد (مضيف واتساب).
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const machineId = String(b?.machineId ?? "").trim();
  if (!machineId) return NextResponse.json({ error: "machineId مطلوب" }, { status: 400 });

  const name = b?.name ? String(b.name).slice(0, 120) : null;
  const towerId = b?.towerId != null ? Number(b.towerId) : null;

  await prisma.hybridWorker.upsert({
    where: { machineId },
    update: { lastSeen: new Date(), ...(name ? { name } : {}), ...(towerId != null ? { towerId } : {}) },
    create: { machineId, name, towerId, lastSeen: new Date() },
  });

  const leader = await computeLeaderMachineId();
  return NextResponse.json({ ok: true, isLeader: leader === machineId, leaderMachineId: leader });
}
