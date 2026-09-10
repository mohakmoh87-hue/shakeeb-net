import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ═════ حذف/تصفير «الإضافي» (overtime) ليومٍ من كشف الراتب — كالخصومات تماماً ═════
// طلبُ محمد (2026-09-10): «يمكنني مسحُ أيّ مبلغٍ إضافيٍّ للفنيّ مثلما أمسح الخصومات».
// الإضافي محسوبٌ آليّاً من وقت الخروج (attendance.overtimeAddition)، فلا زرَّ حذفٍ له في
// نافذة المكافآت/الخصومات (Adjustment). هنا يُصفَّر إضافيُّ يومٍ بعينه، بلقطةِ تدقيق.
// 🔒 بصلاحيّة field.payroll + عزلٌ بـownsTower. ⚖️ وقاعدةُ محمد: المُسدَّدُ في كشفٍ سابقٍ
//    لا يُمَسّ (409) — «إذا أُعطي الموظّفُ راتبَه فلن يُمسَح شيءٌ له بعدها».
export async function POST(request: Request) {
  const g = await guard("field.payroll");
  if (g.error) return g.error;
  const parsed = z.object({
    technicianId: z.coerce.number(),
    dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "يوم غير صالح"),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });

  const t = await prisma.technician.findUnique({ where: { id: parsed.data.technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  // الصفوفُ **غير المُسدَّدة** وحدَها (كشف الراتب الحيّ يقرأ salaryStatementId=null)
  const rows = await prisma.attendance.findMany({
    where: { technicianId: t.id, dayKey: parsed.data.dayKey, salaryStatementId: null, overtimeAddition: { gt: 0 } },
    select: { id: true, overtimeAddition: true },
  });
  if (!rows.length) {
    const settled = await prisma.attendance.findFirst({
      where: { technicianId: t.id, dayKey: parsed.data.dayKey, salaryStatementId: { not: null }, overtimeAddition: { gt: 0 } },
      select: { salaryStatementId: true },
    });
    if (settled) {
      return NextResponse.json({
        error: `⛔ إضافيُّ هذا اليوم محسوبٌ في كشف راتبٍ **مُسدَّدٍ سابقاً** (كشف #${settled.salaryStatementId}) — لا يُمسَح بعد صرف الراتب. صحّحه بخصمٍ جديد.`,
        sealed: true,
      }, { status: 409 });
    }
    return NextResponse.json({ error: "لا إضافي في هذا اليوم" }, { status: 404 });
  }

  const total = rows.reduce((s, r) => s + (r.overtimeAddition ?? 0), 0);
  await prisma.attendance.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { overtimeAddition: 0 } });
  // لقطةُ تدقيقٍ تحمل المبلغَ الأصليَّ — كي يُعاد يدويّاً إن كان الحذفُ سهواً (نمطُ حذف الخصم)
  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId, action: "CLEAR_OVERTIME", entity: "attendance", entityId: `${t.id}|${parsed.data.dayKey}`,
      details: `تصفيرُ الإضافي ${total} د.ع — الفنيّ «${t.name}» (#${t.id}) يوم ${parsed.data.dayKey}` +
               `${g.session?.fullName || g.session?.username ? ` — ${g.session.fullName ?? g.session.username}` : ""}`,
    },
  }).catch(() => {});
  return NextResponse.json({ ok: true, cleared: total });
}
