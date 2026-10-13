import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { baghdadDayKey } from "@/lib/attendance";
import { salaryPeriodBounds, periodLeaveQuota, QUOTA_FIELDS } from "@/lib/salary";

export const dynamic = "force-dynamic";

// ═════ ± حصّةُ إجازاتِ فترةٍ واحدة (طلبُ محمد 2026-10-13) ═════
// «إذا كان له إجازتان هذا الشهر وقرّرتُ في أيّ وقتٍ إضافةَ واحدةٍ له أو حذفَ واحدةٍ منه».
// التعديلُ موسومٌ ببداية الفترة، فلا يمسّ الحصّةَ الشهريّة الدائمة وينقضي بانقضاء فترته.
const schema = z.object({
  technicianId: z.coerce.number().int().positive(),
  delta: z.coerce.number().int().refine((d) => d === 1 || d === -1, "التعديل بوحدةٍ واحدة (+1 أو −1)"),
});

export async function POST(request: Request) {
  const g = await guard("field.payroll");
  if (g.error) return g.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { technicianId, delta } = parsed.data;

  const tech = await prisma.technician.findFirst({
    where: { id: technicianId, isDeleted: false },
    select: { id: true, name: true, towerId: true, agentId: true, ...QUOTA_FIELDS },
  });
  if (!tech || !(await ownsTower(g.session, tech.towerId))) {
    return NextResponse.json({ error: "الفنيّ غير موجود أو لا يتبع مكاتبك" }, { status: 404 });
  }

  const agent = tech.agentId ? await prisma.agent.findUnique({ where: { id: tech.agentId }, select: { salaryFromDay: true, salaryToDay: true } }) : null;
  const today = baghdadDayKey(new Date());
  const period = salaryPeriodBounds(agent?.salaryFromDay, agent?.salaryToDay, today);
  if (!period) return NextResponse.json({ error: "فترةُ الراتب غير مضبوطة للوكيل — اضبط يومَي البداية والنهاية أوّلاً" }, { status: 400 });

  // ⛔ قاعدةُ محمد: «إذا أُعطي الموظّفُ راتبَه فلن يُمسَح شيءٌ له بعدها» — فترةٌ مُسدَّدةٌ لا تُمَسّ
  const sealed = await prisma.salaryStatement.findFirst({
    where: { technicianId, cancelledAt: null }, orderBy: [{ periodTo: "desc" }, { id: "desc" }], select: { periodTo: true },
  });
  if (sealed?.periodTo && period.to <= sealed.periodTo) {
    return NextResponse.json({ error: "فترةُ الراتب الحاليّة مُسدَّدةٌ بكشفٍ — أَلغِ الكشفَ أوّلاً" }, { status: 400 });
  }

  const current = tech.leaveQuotaAdjPeriod === period.from ? (tech.leaveQuotaAdj ?? 0) : 0;
  const before = periodLeaveQuota(tech, period.from);
  // 🔒 لا تنزل الحصّةُ تحت صفر، ولا تحت ما استهلكه فعلاً (وإلّا صار المأخوذُ فوق حصّته بأثرٍ رجعيّ)
  const used = await prisma.leave.count({
    where: { technicianId, kind: "day", paid: true, isDeleted: false, status: { in: ["approved", "pending"] }, dayKey: { gte: period.from, lte: period.to } },
  });
  const after = before + delta;
  if (after < 0) return NextResponse.json({ error: "الحصّةُ صفرٌ — لا إنقاصَ بعده" }, { status: 400 });
  if (delta < 0 && after < used) {
    return NextResponse.json({ error: `أخذ ${used} إجازةً مدفوعةً في هذه الفترة — لا تُنقَص الحصّةُ تحتها (أَزِل إجازةً أوّلاً)` }, { status: 400 });
  }

  await prisma.technician.update({
    where: { id: technicianId },
    data: { leaveQuotaAdj: current + delta, leaveQuotaAdjPeriod: period.from },
  });
  const session = await getSession();
  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId ?? null, action: "LEAVE_QUOTA_ADJUST", entity: "technician", entityId: String(technicianId),
      details: `${delta > 0 ? "زيادةُ" : "إنقاصُ"} حصّةِ إجازاتِ «${tech.name}» المدفوعة ${Math.abs(delta)} للفترة (${period.from} → ${period.to})`
        + ` — من ${before} إلى ${after} (المأخوذ ${used})`
        + (session?.fullName || session?.username ? ` — بواسطة ${session.fullName ?? session.username}` : ""),
    },
  }).catch(() => { /* لا يُفشل التعديل */ });

  return NextResponse.json({ ok: true, quota: after, used, remaining: Math.max(0, after - used), adj: current + delta, period });
}
