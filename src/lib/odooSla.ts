// ===== مهلة سوبر سيل لتذاكر أودو (SLA) — حسابٌ صافٍ يُستورَد في الخادم والعميل معاً =====
//
// القاعدة التي أعطاها محمد (2026-08-09):
//   • سوبر سيل تحتسب المهلة **من ١٠:٠٠ صباحاً إلى ١٢:٠٠ منتصف الليل** بتوقيت بغداد فقط،
//     والعدّاد **يتجمّد** خارج هذه النافذة (فتذكرةُ ٢٣:٠٠ تُكمل عمرها في العاشرة صباحاً غداً).
//   • تذكرةٌ أُنشئت **قبل** العاشرة تُحتسب من العاشرة (ولا يُهدَر عمرُها الليليّ عليه).
//   • ساعتان بلا إجراء (إنجاز/إلغاء/تأجيل) = غرامة ⇒ إنذارٌ عند ٦٠ دقيقة، وتأجيلٌ تلقائيّ عند ٩٠.
//
// المرجع هو **زمن التذكرة في أودو** (create_date) لا لحظة سحبنا: سوبر سيل تحسب من عندها،
// فلو سُحبت تذكرةٌ عمرها ٩٠ دقيقة لكان اعتمادُ لحظة السحب يمنحنا إنذاراً بعد وقوع الغرامة.
//
// ⚠️ منطقة أودو الزمنيّة: يُعيد `create_date` نصّاً **بلا لاحقة منطقة** («2026-08-09 07:15:03»)
// وهو **UTC** — و`new Date(نصّ)` على ويندوز/بغداد يفسّره **محليّاً** فينحرف ٣ ساعات. لذلك
// كلّ تحويلٍ يمرّ عبر odooDateToUtc وحدها.

export const SLA_FROM_HOUR = 10; // بداية نافذة الاحتساب (بغداد)
export const SLA_TO_HOUR = 24; // نهايتها (منتصف الليل)
export const SLA_ALARM_MIN_DEFAULT = 60; // إنذارٌ أحمر
export const SLA_SEND_MIN_DEFAULT = 90; // تأجيلٌ تلقائيّ
export const SLA_TECH_EVERY_MS = 15 * 60_000; // تنبيه الفنيّ كلّ ١٥ دقيقة حتى إنجاز البطاقة أو إلغائها
export const SLA_GRACE_MS = 10 * 60_000; // مهلة رؤيةٍ بعد السحب قبل أيّ إرسال تلقائيّ (طلب محمد)
export const SLA_SEND_CAP = 5; // سقف الإرسال لكلّ مكتب في الدورة (منع رشقة)
export const SLA_WA_TTL_MS = 24 * 3600_000; // رسالة المشترك المؤرشفة تُلغى بعد يوم (طلب محمد)

// العراق ألغى التوقيت الصيفيّ (2008) ⇒ الفرق ثابتٌ +٣ دائماً، فلا حاجة لـIntl ولا خطر انحرافه.
const TZ_OFFSET_MIN = 180;

/** نصّ أودو (UTC ساذج) ⇒ Date صحيح. يقبل ما فيه لاحقة منطقةٍ أصلاً فلا يعبث به. */
export function odooDateToUtc(raw: string | null | undefined): Date | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const iso = hasZone ? s.replace(" ", "T") : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

// دقائق منتصف ليل بغداد ⇒ رقمٌ متّصل يسهل قصّه على النافذة
function baghdadMinutes(d: Date): number {
  return Math.floor(d.getTime() / 60_000) + TZ_OFFSET_MIN;
}

/**
 * دقائق **النافذة** المنقضية بين لحظتين (تتجاهل ما خارج ١٠:٠٠←٢٤:٠٠ بغداد).
 * وبهذا يتحقّق شرط «ما قبل العاشرة يُحتسب من العاشرة» تلقائيّاً بلا قصٍّ منفصل.
 */
export function slaMinutesBetween(from: Date, to: Date): number {
  let a = baghdadMinutes(from);
  const b = baghdadMinutes(to);
  if (!(b > a)) return 0;
  const DAY = 1440;
  const winFrom = SLA_FROM_HOUR * 60;
  const winTo = SLA_TO_HOUR * 60;
  // حرسٌ ضدّ تذكرةٍ قديمةٍ جداً (أو تاريخٍ فاسد): لا نلفّ أكثر من ٦٠ يوماً
  const floor = b - 60 * DAY;
  if (a < floor) a = floor;
  let total = 0;
  for (let day = Math.floor(a / DAY) * DAY; day <= b; day += DAY) {
    const s = Math.max(a, day + winFrom);
    const e = Math.min(b, day + winTo);
    if (e > s) total += e - s;
  }
  return total;
}

export type SlaCard = {
  odooCreatedAt?: string | Date | null;
  odooFetchedAt?: string | Date | null;
  createdAt?: string | Date | null;
  slaNoteAt?: string | Date | null;
  done?: boolean;
  settled?: boolean;
  postponedTo?: string | Date | null;
  viaOdoo?: boolean | null;
};

const asDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** لحظة بدء الاحتساب: زمن أودو إن وُجد، وإلّا لحظة السحب، وإلّا إنشاء البطاقة. */
export function slaStartOf(c: SlaCard): Date | null {
  return asDate(c.odooCreatedAt) ?? asDate(c.odooFetchedAt) ?? asDate(c.createdAt);
}

export type SlaLevel = "none" | "ok" | "danger" | "over";
export type SlaState = {
  level: SlaLevel; // danger = تجاوزت عتبة الإنذار · over = تجاوزت عتبة الإرسال
  ageMin: number; // عمر التذكرة بدقائق النافذة
  toAlarmMin: number; // المتبقّي حتى الإنذار
  toSendMin: number; // المتبقّي حتى الإرسال التلقائيّ (هذا ما يُعرَض — لا ذكرَ لغرامةٍ في أيّ مكان)
};

/**
 * حالة البطاقة الآن. «الإجراء» الذي يُخرجها من الحساب: إنجاز أو إلغاء أو تأجيل
 * (ملاحظةُ التأجيل في أودو = slaNoteAt ⇒ خروجٌ نهائيّ بقرار محمد: «تخرج من المهلة تماماً»).
 */
export function slaStateOf(
  c: SlaCard,
  now: Date = new Date(),
  alarmMin: number = SLA_ALARM_MIN_DEFAULT,
  sendMin: number = SLA_SEND_MIN_DEFAULT,
): SlaState {
  const off: SlaState = { level: "none", ageMin: 0, toAlarmMin: 0, toSendMin: 0 };
  if (!c.viaOdoo || c.done || c.settled) return off;
  if (asDate(c.slaNoteAt) || asDate(c.postponedTo)) return off; // اتُّخذ إجراء
  const start = slaStartOf(c);
  if (!start) return off;
  const ageMin = slaMinutesBetween(start, now);
  const level: SlaLevel = ageMin >= sendMin ? "over" : ageMin >= alarmMin ? "danger" : "ok";
  return { level, ageMin, toAlarmMin: Math.max(0, alarmMin - ageMin), toSendMin: Math.max(0, sendMin - ageMin) };
}

/** «٠:٤٧» من دقائق — للعدّاد على البطاقة والمربّع. */
export function fmtMin(m: number): string {
  const t = Math.max(0, Math.round(m));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** هل نحن داخل نافذة الاحتساب الآن؟ (خارجها لا واتساب تلقائيّ — لا رسالة الثالثة فجراً) */
export function inSlaWindow(now: Date = new Date()): boolean {
  const m = ((baghdadMinutes(now) % 1440) + 1440) % 1440;
  return m >= SLA_FROM_HOUR * 60 && m < SLA_TO_HOUR * 60;
}

export const SLA_NOTE_DEFAULT = "تم التأجيل بطلب من المشترك";
export const SLA_WA_DEFAULT =
  "عزيزنا المشترك، نعتذر عن التأخير — تمّ تأجيل موعد زيارة الفنيّ، وسنتواصل معكم لتحديد موعدٍ جديد. شكراً لتفهّمكم.";
export const SLA_TECH_DEFAULT =
  "⏳ تذكرة أودو {التذكرة} تأخّرت — أنجزها أو ألغِها أو أجّلها الآن. {الهاتف}";

/** استبدال متغيّرات نصّ المدير. */
export function fillSlaText(tpl: string, v: { office?: string | null; ticket?: number | null; phone?: string | null; bg?: string | null }): string {
  return tpl
    .replace(/\{المكتب\}/g, v.office ?? "")
    .replace(/\{التذكرة\}/g, v.ticket != null ? `#${v.ticket}` : "")
    .replace(/\{الهاتف\}/g, v.phone ?? "")
    .replace(/\{اليوزر\}/g, v.bg ?? "")
    .trim();
}
