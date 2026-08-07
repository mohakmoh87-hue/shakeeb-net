import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { computeLeaderMachineId, isOnline } from "@/lib/hybridLeader";

export const dynamic = "force-dynamic";

// قائمة حواسيب النظام الهجين مع حالتها وأولويتها (للمدير)
// عزل المستأجر: يرى حواسيب وكيله + الحواسيب الجديدة غير المُطالَب بها (agentId=null) لاعتمادها.
export async function GET() {
  const g = await guard("hybrid.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;

  const [workers, blockedWorkers, leader, towers] = await Promise.all([
    // تُخفى المحظورة (المحذوفة) فلا تعود للظهور رغم استمرار نبضتها
    prisma.hybridWorker.findMany({ where: { blocked: false, OR: [{ agentId }, { agentId: null }] }, orderBy: [{ priority: "asc" }, { id: "asc" }] }),
    prisma.hybridWorker.findMany({ where: { blocked: true, OR: [{ agentId }, { agentId: null }] }, orderBy: [{ id: "asc" }] }),
    computeLeaderMachineId(agentId),
    prisma.tower.findMany({ where: { isDeleted: false, agentId }, select: { id: true, name: true } }),
  ]);
  const tn = new Map(towers.map((t) => [t.id, t.name]));
  // الاسم المعروض = ما حدّده المدير (displayName) وإلا اسم الجهاز التلقائي
  const shown = (w: { displayName: string | null; name: string | null }) => w.displayName ?? w.name;

  return NextResponse.json({
    leaderMachineId: leader,
    // مكاتب الوكيل — لقائمة اختيار «المكتب» لكل حاسبة (الربط شرطُ عمل الواتساب)
    offices: towers.map((t) => ({ id: t.id, name: t.name })),
    workers: workers.map((w) => ({
      id: w.id, machineId: w.machineId, name: shown(w), towerId: w.towerId,
      officeName: w.towerId != null ? tn.get(w.towerId) ?? null : null,
      priority: w.priority, approved: w.approved, lastSeen: w.lastSeen,
      online: isOnline(w.lastSeen), isLeader: leader === w.machineId,
    })),
    // الحاسبات المحظورة (المحذوفة) — لرفع الحظر عند الحاجة
    blocked: blockedWorkers.map((w) => ({
      id: w.id, machineId: w.machineId, name: shown(w), lastSeen: w.lastSeen, online: isOnline(w.lastSeen),
    })),
  });
}

// تعديل حاسبة: الأولوية، الاسم، المكتب المربوطة به، أو الموافقة/الإيقاف
export async function PATCH(request: Request) {
  const g = await guard("hybrid.manage");
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
  // الاسم يُحفظ في displayName كي لا تطمسه نبضة العامل (تكتب name = اسم الجهاز)
  if (typeof b?.name === "string") data.displayName = b.name.trim().slice(0, 120) || null;
  if (typeof b?.approved === "boolean") {
    data.approved = b.approved;
    // الاعتماد يُطالِب الحاسبة لوكيل هذا المدير (عزل جلسات الواتساب)
    if (b.approved && agentId != null) data.agentId = agentId;
  }
  // ربط الحاسبة بمكتبها — شرطُ عمل الواتساب: العامل يستضيف جلسة مكتبه المربوط حصراً،
  // وبلا ربط لا يشغّل شيئاً (فلا يتجدّد QR). null = فكّ الربط.
  // عزل المستأجر: لا يُقبل إلا مكتب يتبع وكيل هذا المدير.
  if (b?.towerId !== undefined) {
    if (b.towerId === null || b.towerId === "") {
      data.towerId = null;
    } else {
      const tid = Number(b.towerId);
      if (!Number.isInteger(tid)) return NextResponse.json({ error: "مكتب غير صحيح" }, { status: 400 });
      const owned = agentId != null && (await prisma.tower.findFirst({ where: { id: tid, agentId, isDeleted: false }, select: { id: true } }));
      if (!owned) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
      data.towerId = tid;
    }
  }
  // رفع الحظر عن حاسبة محظورة (تعود للظهور كحاسبة بانتظار الاعتماد)
  if (b?.blocked === false) data.blocked = false;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  await prisma.hybridWorker.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

// حذف حاسبة: افتراضيّاً حظر ناعم (blocked=true) بدل الحذف الفعلي — كي لا تعيد نبضتها
// إنشاء الصفّ فتظهر ثانيةً. تبقى مخفيّة، وعاملها يتوقّف تلقائياً عند تحديث كوده.
// hard=1: حذفٌ نهائيّ **للحاسبة المحظورة فقط** (لجهازٍ مُستبعَد فعليّاً). إن كان الجهاز
// ما زال يعمل فسيُسجّل نفسه من جديد كحاسبةٍ «بانتظار الاعتماد» — فلا تعتمِدها.
export async function DELETE(request: Request) {
  const g = await guard("hybrid.manage");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const hard = url.searchParams.get("hard") === "1";
  // عزل المستأجر: لا تُحظر/تُحذف إلا حاسبة تتبع وكيل المدير أو غير مُطالَب بها
  const agentId = g.session?.agentId ?? null;

  if (hard) {
    // حذفٌ نهائيّ — للمحظورة حصراً (تُحظر أولاً ثم تُحذف نهائيّاً)، ضمن عزل الوكيل.
    const res = await prisma.hybridWorker.deleteMany({
      where: { id, blocked: true, OR: [{ agentId }, { agentId: null }] },
    });
    if (res.count === 0) return NextResponse.json({ error: "الحاسبة غير محظورة أو لا تتبع حسابك" }, { status: 403 });
    return NextResponse.json({ ok: true, hard: true });
  }

  const upd = await prisma.hybridWorker.updateMany({
    where: { id, OR: [{ agentId }, { agentId: null }] },
    data: { blocked: true, approved: false },
  });
  if (upd.count === 0) return NextResponse.json({ error: "الحاسبة لا تتبع حسابك" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
