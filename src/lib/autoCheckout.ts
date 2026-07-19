import { prisma } from "./prisma";
import { baghdadDayKey, computeAttendance, parseHHMM } from "./attendance";
import { endSupport } from "./field";
import { notify } from "./notify";

// وقت نهاية الدوام (كـ Date) لليوم الذي بدأ فيه الفني — لبصمة خروج تلقائية بلا إضافي.
function scheduledCheckout(checkIn: Date, shiftEnd: string | null): Date {
  const endMin = parseHHMM(shiftEnd);
  if (endMin == null) return checkIn; // بلا دوام محدّد → لا دقائق إضافية
  const b = new Date(checkIn.getTime() + 3 * 3600 * 1000); // يوم بغداد للبصمة
  const bgMidnightUtc = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), 0, 0, 0) - 3 * 3600 * 1000;
  return new Date(bgMidnightUtc + endMin * 60 * 1000);
}

// بصمة خروج تلقائية لمن نسي الخروج: بعد منتصف الليل، كل حضور بلا خروج ليومٍ سابق
// يُغلَق بوقت الخروج المثبّت (بلا إضافي) + خصم غرامة النسيان + إنهاء الدعم إن وُجد.
export async function runAutoCheckout(): Promise<{ closed: number }> {
  const todayKey = baghdadDayKey(new Date());
  const stale = await prisma.attendance.findMany({
    where: { checkIn: { not: null }, checkOut: null, dayKey: { not: null, lt: todayKey } },
    take: 500,
  });
  if (stale.length === 0) return { closed: 0 };

  let closed = 0;
  for (const rec of stale) {
    if (!rec.checkIn) continue;
    const t = await prisma.technician.findUnique({
      where: { id: rec.technicianId },
      select: { name: true, agentId: true, towerId: true, supportTowerId: true, shiftStart: true, shiftEnd: true, entryGraceMin: true, exitGraceMin: true, lateRatePerMin: true, overtimeRatePerMin: true, missedCheckoutPenalty: true },
    });
    if (!t) continue;
    const checkoutAt = scheduledCheckout(rec.checkIn, t.shiftEnd);
    const calc = computeAttendance(t, rec.checkIn, checkoutAt); // خروج بوقته ⇒ بلا إضافي
    // إن كان مُعاراً (دعم) والدخول بمكتبٍ آخر: تُنسب بصمة الخروج لمكتب الدعم
    const outTower = t.supportTowerId != null && t.supportTowerId !== rec.towerId ? t.supportTowerId : null;
    // إغلاق ذرّي مشروط بأن السجل ما زال مفتوحاً — يمنع الغرامة المكرّرة إن تسابق التدارك والكرون
    const upd = await prisma.attendance.updateMany({ where: { id: rec.id, checkOut: null }, data: { checkOut: checkoutAt, checkoutBy: "auto", checkOutTowerId: outTower, ...calc } }).catch(() => ({ count: 0 }));
    if (!upd || upd.count === 0) continue; // أُغلق من عمليةٍ أخرى — تفادي التكرار

    // غرامة نسيان بصمة الخروج (تُعتمد فوراً وتظهر بتفاصيل الراتب)
    const penalty = t.missedCheckoutPenalty ?? 0;
    if (penalty > 0) {
      await prisma.adjustment.create({
        data: { technicianId: rec.technicianId, agentId: t.agentId, towerId: t.towerId, kind: "deduction", source: "missed-checkout", amount: penalty, reason: `غرامة نسيان بصمة الخروج (${rec.dayKey})`, status: "confirmed", dayKey: rec.dayKey ?? todayKey, decidedBy: "النظام", decidedAt: new Date() },
      }).catch(() => {});
    }
    // إنهاء الدعم إن كان الفني مُعاراً (يعود لمكتبه بنهاية الدوام)
    if (t.supportTowerId != null) await endSupport(rec.technicianId).catch(() => {});
    void notify({ agentId: t.agentId, towerId: t.towerId, type: "checkout", title: "خروج تلقائي", body: `${t.name}: خروج تلقائي (نسيان البصمة)${penalty > 0 ? ` — غرامة ${penalty.toLocaleString("en-US")}` : ""}`, refType: "technician", refId: rec.technicianId });
    closed++;
  }
  return { closed };
}
