import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ═════ البند ٧ · «يمكن للمدير مسحُ أيّ خصمٍ على موظّفٍ ولأيّ سبب» (طلبُ محمد 2026-08-14) ═════
//
// «ليس فقط البصمة» — أيُّ خصمٍ على صفّ حضورٍ يُمسَح بقرار المدير.
//
// 🔑 **والمسحُ سجلٌّ لا محوٌ**: مَن مسح ومتى ولماذا و**كم كان** — كلُّها تُكتب. فشرطُ محمد
//   الدائم «ألّا يضيع شيء»، وكشفُ راتبٍ فيه خصمٌ اختفى بلا أثرٍ لا يُمكن تفسيرُه لاحقاً.
//
// ⛔ **وقاعدةٌ حاكمةٌ بنصّ محمد (2026-08-14): «إذا أُعطي الموظّفُ راتبَه فلن يُمسَح شيءٌ
//   له بعدها».** فيومٌ مختومٌ بكشفِ راتب (`salaryStatementId != null`) **يُرفض مسحُه**
//   برسالةٍ صريحة — لا صمتاً ولا نجاحاً كاذباً. (وهو نفسُ حرسِ أ-٨ لحذف الإجازة.)
const schema = z.object({
  attendanceId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1, "سبب المسح مطلوب").max(400),
});

export async function POST(request: Request) {
  // 🔒 صلاحيّةُ الرواتب والخصومات — لا صلاحيّةُ تشغيل اللوحة
  const g = await guard("field.payroll");
  if (g.error) return g.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { attendanceId, reason } = parsed.data;

  const rec = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    select: {
      id: true, technicianId: true, towerId: true, dayKey: true,
      lateDeduction: true, earlyDeduction: true,
      salaryStatementId: true, deductionClearedAt: true,
    },
  });
  if (!rec) return NextResponse.json({ error: "سجلّ الحضور غير موجود" }, { status: 404 });

  // 🔒 العزل: مكتبُ الفنيّ يجب أن يتبع وكيلَ المستخدم. ويُقرأ من **الفنيّ** لا من صفّ
  //   الحضور وحدَه: `Attendance.towerId` هو مكتبُ البصمة وقد يكون مكتبَ دعمٍ (أ-١٠)،
  //   والمرجعُ في كلّ الإجراءات مكتبُه الأصليّ.
  const tech = await prisma.technician.findUnique({
    where: { id: rec.technicianId },
    select: { id: true, name: true, towerId: true },
  });
  const mine = await agentTowerIds(g.session ?? null);
  const owns = (id: number | null | undefined) => id != null && mine.includes(id);
  if (!owns(tech?.towerId) && !owns(rec.towerId)) {
    return NextResponse.json({ error: "هذا الفنيّ لا يتبع حسابك" }, { status: 403 });
  }

  // ⛔ قاعدةُ «لا مسحَ بعد صرف الراتب»
  if (rec.salaryStatementId != null) {
    return NextResponse.json({
      error: "هذا اليوم مختومٌ بكشف راتبٍ مصروف — ولا يُمسَح خصمٌ بعد صرف الراتب.",
    }, { status: 409 });
  }

  const total = (rec.lateDeduction ?? 0) + (rec.earlyDeduction ?? 0);
  if (total <= 0 && rec.deductionClearedAt == null) {
    return NextResponse.json({ error: "لا يوجد خصمٌ على هذا اليوم" }, { status: 400 });
  }

  // الحَجزُ قبل الأثر: يُشترَط أنّه **لم يُمسَح سلفاً** — فضغطتان لا تُسجّلان مسحَين
  // ولا تطمس الثانيةُ مبلغَ الأصل بصفرٍ (وهو ما يُفقد أثرَ ما أُعفي عنه).
  const claimed = await prisma.attendance.updateMany({
    where: { id: rec.id, deductionClearedAt: null, salaryStatementId: null },
    data: {
      lateDeduction: 0, earlyDeduction: 0,
      deductionClearedBy: g.session?.username ?? "مدير",
      deductionClearedAt: new Date(),
      deductionClearReason: reason,
      deductionClearedAmount: total,
    },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "الخصمُ مُسِح سابقاً (أو خُتم اليوم بكشفٍ الآن)" }, { status: 409 });
  }

  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId,
      action: "CLEAR_DEDUCTION",
      entity: "attendance",
      entityId: String(rec.id),
      details: `مسحُ خصمٍ ${total} للفنيّ ${tech?.name ?? rec.technicianId} — يوم ${rec.dayKey ?? "؟"} — السبب: ${reason}`,
    },
  }).catch(() => { /* السجلُّ مكسبٌ لا شرطٌ لإتمام قرار المدير */ });

  return NextResponse.json({ ok: true, cleared: total });
}
