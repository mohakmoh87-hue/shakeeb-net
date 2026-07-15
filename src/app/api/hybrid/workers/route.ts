import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { computeLeaderMachineId, isOnline } from "@/lib/hybridLeader";

export const dynamic = "force-dynamic";

// قائمة حواسيب النظام الهجين مع حالتها وأولويتها (للمدير)
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  const [workers, leader, towers] = await Promise.all([
    prisma.hybridWorker.findMany({ orderBy: [{ priority: "asc" }, { id: "asc" }] }),
    computeLeaderMachineId(),
    prisma.tower.findMany({ where: { isDeleted: false }, select: { id: true, name: true } }),
  ]);
  const tn = new Map(towers.map((t) => [t.id, t.name]));

  return NextResponse.json({
    leaderMachineId: leader,
    workers: workers.map((w) => ({
      id: w.id, machineId: w.machineId, name: w.name, towerId: w.towerId,
      officeName: w.towerId != null ? tn.get(w.towerId) ?? null : null,
      priority: w.priority, approved: w.approved, lastSeen: w.lastSeen,
      online: isOnline(w.lastSeen), isLeader: leader === w.machineId,
    })),
  });
}

// تعديل حاسبة: الأولوية، الاسم، أو الموافقة/الإيقاف
export async function PATCH(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const b = await request.json().catch(() => null);
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (b?.priority != null && Number.isFinite(Number(b.priority))) data.priority = Math.max(0, Math.round(Number(b.priority)));
  if (typeof b?.name === "string") data.name = b.name.trim().slice(0, 120) || null;
  if (typeof b?.approved === "boolean") data.approved = b.approved;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  await prisma.hybridWorker.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

// حذف حاسبة من القائمة (مثلاً حاسبة قديمة أُزيلت)
export async function DELETE(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  await prisma.hybridWorker.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
