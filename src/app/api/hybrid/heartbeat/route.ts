import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeLeaderMachineId } from "@/lib/hybridLeader";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// نبضة العامل المحلي: يسجّل الحاسبة/يحدّث آخر ظهور، ويعيد هل هي القائد (مضيف واتساب).
export async function POST(request: Request) {
  // حدّ سخيّ يكفي عدّة عمّال خلف IP واحد (كل عامل ينبض ~كل 20ث) ويمنع الإغراق
  if (!rateLimit(`hb:${clientIp(request)}`, 120, 60_000)) {
    return NextResponse.json({ error: "too many" }, { status: 429 });
  }
  const b = await request.json().catch(() => null);
  const machineId = String(b?.machineId ?? "").trim();
  if (!machineId) return NextResponse.json({ error: "machineId مطلوب" }, { status: 400 });

  const name = b?.name ? String(b.name).slice(0, 120) : null;
  const towerId = b?.towerId != null ? Number(b.towerId) : null;

  const existing = await prisma.hybridWorker.findUnique({ where: { machineId }, select: { nodeNumber: true, approved: true, agentId: true } });

  let nodeNumber = existing?.nodeNumber ?? null;
  if (nodeNumber == null) {
    // تعيين رقم عقدة فريد (السحابة=0؛ الحواسيب تبدأ من 1) لنظام المعرّفات المُنطَّقة
    const agg = await prisma.hybridWorker.aggregate({ _max: { nodeNumber: true } });
    nodeNumber = (agg._max.nodeNumber ?? 0) + 1;
  }

  await prisma.hybridWorker.upsert({
    where: { machineId },
    // لا نُحدّث الاسم عند النبضة حتى يبقى الاسم الذي حدّده المدير؛ الاسم يُضبط عند الإنشاء فقط
    update: { lastSeen: new Date(), nodeNumber, ...(towerId != null ? { towerId } : {}) },
    create: { machineId, name, towerId, nodeNumber, lastSeen: new Date() }, // approved=false افتراضياً
  });

  const approved = existing?.approved ?? false;
  // قائد وكيل هذه الحاسبة فقط
  const leader = await computeLeaderMachineId(existing?.agentId ?? null);
  return NextResponse.json({ ok: true, approved, isLeader: leader === machineId, leaderMachineId: leader, nodeMachineId: machineId, nodeNumber });
}
