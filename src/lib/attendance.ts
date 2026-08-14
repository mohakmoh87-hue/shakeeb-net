// حسابات الحضور — تطبيق إدارة الفنيين. كل الأوقات بتوقيت بغداد (UTC+3 ثابت بلا صيفي).
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

// وقت بغداد كساعة حائط (نستخدم getUTC* بعد الإزاحة)
function baghdad(d: Date): Date {
  return new Date(d.getTime() + BAGHDAD_OFFSET_MS);
}
export function baghdadMinutesOfDay(d: Date): number {
  const b = baghdad(d);
  return b.getUTCHours() * 60 + b.getUTCMinutes();
}
export function baghdadDayKey(d: Date): string {
  return baghdad(d).toISOString().slice(0, 10);
}
// المسافة بالأمتار بين نقطتين (Haversine) — للبصمة الجغرافية
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // نصف قطر الأرض بالأمتار
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// "HH:MM" → دقائق منذ منتصف الليل، أو null
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

export type TechShift = {
  shiftStart: string | null; shiftEnd: string | null;
  entryGraceMin: number | null; exitGraceMin: number | null;
  lateRatePerMin: number | null; overtimeRatePerMin: number | null;
};
export type AttendanceCalc = {
  lateMinutes: number; earlyMinutes: number; overtimeMinutes: number;
  lateDeduction: number; earlyDeduction: number; overtimeAddition: number;
};

/** إجازةٌ زمنيّةٌ **معتمدةٌ** لذلك اليوم — بدقائق اليوم (٠…١٤٣٩). */
export type TimeLeave = { startMin: number; endMin: number };

// ═════════ الإجازةُ الزمنيّة: تُزيح حدَّ الدوام لذلك اليوم وحدَه (طلبُ محمد) ═════════
// «زمنيّةٌ ١٢ ظهراً ← ٤ عصراً: بصمةُ دخوله أصلاً ١٢، فبعد موافقة المدير **تنتقل بصمةُ دخوله
//  إلى ٤ عصراً — في هذا اليوم فقط**» · و«٩ ← ١١ ليلاً: بصمةُ خروجه تنتقل إلى ٩».
// 🔑 والتطبيقُ **إزاحةُ الحدّ لا تعديلُ البصمة**: البصمةُ الحقيقيّةُ تبقى كما سُجّلت (فالتاريخُ
//   لا يُزوَّر)، ويُحاسَب اليومُ على دوامٍ مُقلَّص — فيسقط الخصمُ وحدَه.
// ⛔ والإجازةُ **وسطَ الدوام** لا تُزيح شيئاً: ألغى محمد «بصمتين في يومٍ واحد» (2026-08-14)،
//   فلا مقاطعَ حضورٍ — وتبقى للتوثيق ولاستبعاده من التوزيع التلقائيّ وقتَها (autoAssign).
function shiftWithLeave(startMin: number, endMin: number, leave?: TimeLeave | null): { s: number; e: number } {
  if (!leave || leave.endMin <= leave.startMin) return { s: startMin, e: endMin };
  // تلامسُ بدايةَ الدوام ⇒ يبدأ دوامُه من نهايتها (ولا يتجاوز نهايةَ الدوام)
  if (leave.startMin <= startMin && leave.endMin > startMin) return { s: Math.min(leave.endMin, endMin), e: endMin };
  // تلامسُ نهايةَ الدوام ⇒ ينتهي دوامُه ببدايتها (ولا ينزل تحت بدايته)
  if (leave.endMin >= endMin && leave.startMin < endMin) return { s: startMin, e: Math.max(leave.startMin, startMin) };
  return { s: startMin, e: endMin }; // وسطَ الدوام ⇒ بلا إزاحة (الحالةُ ٣ الملغاة)
}

// حساب التأخير/الخروج المبكّر/الإضافي وفق القواعد المؤكّدة.
// `timeLeave`: إجازةٌ زمنيّةٌ معتمدةٌ لذلك اليوم — تُزيح حدَّ الدوام فيسقط خصمُها.
export function computeAttendance(tech: TechShift, checkIn: Date, checkOut: Date, timeLeave?: TimeLeave | null): AttendanceCalc {
  const zero: AttendanceCalc = { lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0, lateDeduction: 0, earlyDeduction: 0, overtimeAddition: 0 };
  const rawStart = parseHHMM(tech.shiftStart);
  const rawEnd = parseHHMM(tech.shiftEnd);
  if (rawStart == null || rawEnd == null) return zero;
  const { s: startMin, e: endShifted } = shiftWithLeave(rawStart, rawEnd, timeLeave);
  let endMin = endShifted;
  const ge = Math.max(0, tech.entryGraceMin ?? 0);
  const xg = Math.max(0, tech.exitGraceMin ?? 0);
  const lr = Math.max(0, tech.lateRatePerMin ?? 0);
  const or = Math.max(0, tech.overtimeRatePerMin ?? 0);
  if (endMin <= startMin) endMin += 1440; // دوام يعبر منتصف الليل

  // البصمة قبل موعد الدخول لا تُحتسب نهائياً — يُعتمد بدء الدوام كبداية فعلية
  let ci = baghdadMinutesOfDay(checkIn);
  if (ci < startMin) ci = startMin;
  let co = baghdadMinutesOfDay(checkOut);
  if (co < ci) co += 1440; // خروج في يوم لاحق

  // تأخير الدخول: تجاوُز السماحية يُلغيها — يُحاسَب من موعد بدء الدوام نفسه
  // (مثل الخروج المبكّر: سماحية 15 ودخول 12:16 على دوام 12:00 ⇒ خصم 16 دقيقة لا دقيقة واحدة)
  const lateMinutes = ci > startMin + ge ? ci - startMin : 0;
  const lateDeduction = lateMinutes * lr;

  // الخروج: نافذة السماحية [E−xg, E+xg]
  let earlyMinutes = 0, overtimeMinutes = 0, earlyDeduction = 0, overtimeAddition = 0;
  const graceStart = endMin - xg, graceEnd = endMin + xg;
  if (co < graceStart) {
    // خروج مبكّر قبل النافذة ← تُلغى السماحية ويُحاسب حتى نهاية الدوام كاملاً
    earlyMinutes = endMin - co;
    earlyDeduction = earlyMinutes * lr;
  } else if (co > graceEnd) {
    // خروج إضافي بعد النافذة
    overtimeMinutes = co - graceEnd;
    overtimeAddition = overtimeMinutes * or;
  }
  return { lateMinutes, earlyMinutes, overtimeMinutes, lateDeduction, earlyDeduction, overtimeAddition };
}
