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
// resetSupport (المهمة الليلية 00:15 فقط): يُنهي أيضاً **كل** دعم نشط (يوم كامل أو بطاقات)
// عند بدء اليوم الجديد — لا يُمرَّر من تدارك الإقلاع/التشغيل اليدوي كي لا يُنهي دعم اليوم نفسه.
export async function runAutoCheckout(opts?: { resetSupport?: boolean }): Promise<{ closed: number; supportEnded: number }> {
  const todayKey = baghdadDayKey(new Date());
  const stale = await prisma.attendance.findMany({
    where: { checkIn: { not: null }, checkOut: null, dayKey: { not: null, lt: todayKey } },
    take: 500,
  });

  let closed = 0;
  for (const rec of stale) {
    if (!rec.checkIn) continue;
    const t = await prisma.technician.findUnique({
      where: { id: rec.technicianId },
      select: { name: true, agentId: true, towerId: true, supportTowerId: true, shiftStart: true, shiftEnd: true, entryGraceMin: true, exitGraceMin: true, lateRatePerMin: true, overtimeRatePerMin: true, missedCheckoutPenalty: true },
    });
    if (!t) continue;
    const checkoutAt = scheduledCheckout(rec.checkIn, t.shiftEnd);
    // ومعه الإجازةُ الزمنيّةُ المعتمدةُ لذلك اليوم — فلا يُخصَم وقتٌ أذن به المديرُ (طلبُ محمد)
    const { approvedTimeLeaveFor } = await import("@/lib/field");
    const tl = await approvedTimeLeaveFor(rec.technicianId, rec.dayKey);
    const calc = computeAttendance(t, rec.checkIn, checkoutAt, tl); // خروج بوقته ⇒ بلا إضافي
    // إن كان مُعاراً (دعم) والدخول بمكتبٍ آخر: تُنسب بصمة الخروج لمكتب الدعم
    const outTower = t.supportTowerId != null && t.supportTowerId !== rec.towerId ? t.supportTowerId : null;
    // إغلاق ذرّي مشروط بأن السجل ما زال مفتوحاً — يمنع الغرامة المكرّرة إن تسابق التدارك والكرون
    // متوسّط(٢٣) · الإغلاقُ والغرامةُ معاملةٌ واحدة: كان الإغلاقُ الذرّيُّ يستهلك فرصتَه
    // ثمّ تُنشأ الغرامةُ منفصلةً بـcatch فارغ — ففشلُها يضيّعها صامتةً **إلى الأبد**
    // (السجلُّ أُغلق فلا إعادةَ أبداً). الآن: إن فشل أيُّ طرفٍ رُجع الكلُّ فتُعاد المحاولةُ
    // في الدورة القادمة، وشرطُ checkOut: null داخل المعاملة يبقي منعَ التكرار كما هو.
    const penalty = t.missedCheckoutPenalty ?? 0;
    let updCount = 0;
    try {
      await prisma.$transaction(async (tx) => {
        const upd = await tx.attendance.updateMany({ where: { id: rec.id, checkOut: null }, data: { checkOut: checkoutAt, checkoutBy: "auto", checkOutTowerId: outTower, ...calc } });
        updCount = upd.count;
        if (upd.count === 0) return; // أُغلق من عمليةٍ أخرى — تفادي التكرار
        // الغرامة «معلّقة» فلا تُخصم حتى يقرّرها المدير في نافذة المراجعة
        if (penalty > 0) {
          await tx.adjustment.create({
            data: { technicianId: rec.technicianId, agentId: t.agentId, towerId: t.towerId, kind: "deduction", source: "missed-checkout", amount: penalty, reason: `غرامة نسيان بصمة الخروج (${rec.dayKey})`, status: "pending", dayKey: rec.dayKey ?? todayKey },
          });
        }
      });
    } catch (e) {
      console.error(`[auto-checkout] تعذّر إغلاقُ سجلّ الفنيّ #${rec.technicianId} (${rec.dayKey}) — يُعاد في الدورة القادمة:`, e instanceof Error ? e.message : e);
      continue;
    }
    if (updCount === 0) continue;
    // إنهاء الدعم إن كان الفني مُعاراً (يعود لمكتبه بنهاية الدوام)
    if (t.supportTowerId != null) await endSupport(rec.technicianId).catch(() => {});
    void notify({ agentId: t.agentId, towerId: t.towerId, type: "checkout", title: "خروج تلقائي", body: `${t.name}: خروج تلقائي (نسيان البصمة)${penalty > 0 ? ` — غرامة ${penalty.toLocaleString("en-US")}` : ""}`, refType: "technician", refId: rec.technicianId });
    closed++;
  }

  // إنهاء كل دعم نشط (يوم كامل أو بطاقات) عند بدء اليوم الجديد — يعود كل فنيّ لمكتبه بصرف النظر
  // عن حضوره أو إكمال بطاقاته (endSupport يرحّل ذممه لمكتبه). يُشغَّل من مهمة 00:15 الليلية فقط.
  let supportEnded = 0;
  if (opts?.resetSupport) {
    const supported = await prisma.technician.findMany({
      where: { supportTowerId: { not: null }, isDeleted: false },
      select: { id: true },
      take: 1000,
    });
    for (const s of supported) { await endSupport(s.id).catch(() => {}); supportEnded++; }
  }
  return { closed, supportEnded };
}
