import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { computeLeaderMachineId, isOnline } from "@/lib/hybridLeader";

export const dynamic = "force-dynamic";

// قائمة حواسيب النظام الهجين مع حالتها وأولويتها (للمدير)
// عزل المستأجر: يرى حواسيب وكيله + الحواسيب الجديدة غير المُطالَب بها (agentId=null) لاعتمادها.
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;

  const [workers, leader, towers] = await Promise.all([
    // تُخفى المحظورة (المحذوفة) فلا تعود للظهور رغم استمرار نبضتها
    prisma.hybridWorker.findMany({ where: { blocked: false, OR: [{ agentId }, { agentId: null }] }, orderBy: [{ priority: "asc" }, { id: "asc" }] }),
    computeLeaderMachineId(agentId),
    prisma.tower.findMany({ where: { isDeleted: false, agentId }, select: { id: true, name: true } }),
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
  // عزل المستأجر: الحاسبة يجب أن تتبع وكيل المدير أو تكون غير مُطالَب بها (جديدة)
  const agentId = g.session?.agentId ?? null;
  const w = await prisma.hybridWorker.findUnique({ where: { id }, select: { agentId: true } });
  if (!w || (w.agentId != null && w.agentId !== agentId)) {
    return NextResponse.json({ error: "الحاسبة لا تتبع حسابك" }, { status: 403 });
  }
  const data: Record<string, unknown> = {};
  if (b?.priority != null && Number.isFinite(Number(b.priority))) data.priority = Math.max(0, Math.round(Number(b.priority)));
  if (typeof b?.name === "string") data.name = b.name.trim().slice(0, 120) || null;
  if (typeof b?.approved === "boolean") {
    data.approved = b.approved;
    // الاعتماد يُطالِب الحاسبة لوكيل هذا المدير (عزل جلسات الواتساب)
    if (b.approved && agentId != null) data.agentId = agentId;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  await prisma.hybridWorker.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

// حذف حاسبة من القائمة: حظر ناعم (blocked=true) بدل الحذف الفعلي — كي لا تعيد نبضتها
// إنشاء الصفّ فتظهر ثانيةً. تبقى مخفيّة، وعاملها يتوقّف تلقائياً عند تحديث كوده.
export async function DELETE(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  // عزل المستأجر: لا تُحظر إلا حاسبة تتبع وكيل المدير أو غير مُطالَب بها
  const agentId = g.session?.agentId ?? null;
  const upd = await prisma.hybridWorker.updateMany({
    where: { id, OR: [{ agentId }, { agentId: null }] },
    data: { blocked: true, approved: false },
  });
  if (upd.count === 0) return NextResponse.json({ error: "الحاسبة لا تتبع حسابك" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
