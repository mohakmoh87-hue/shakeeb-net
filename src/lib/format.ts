// تنسيق موحّد للتاريخ في كل البرنامج: يوم/شهر/سنة (07/07/2026)
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// التاريخ مع الوقت: يوم/شهر/سنة ساعة:دقيقة
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(date)} ${hh}:${mi}`;
}

// ═════ ⏰ ساعةُ الانتهاء ودقيقتُه — قاعدةُ قراءةٍ واحدةٌ للبرنامج كلِّه (طلبُ محمد 2026-08-21) ═════
//
// **القياسُ الذي بُنيت عليه** (2026-08-21، من لوحة الساس نفسِها لا من ظنٍّ):
//   • `Users List` يعرض الانتهاءَ **بالساعة والدقيقة والثانية**، ويختلف من مشتركٍ لآخر
//     (`17:00:00` · `21:23:02` · `21:11:54` · `21:59:45`)، بينما «الأيّام المتبقية» عنده
//     أيّامٌ صحيحةٌ فقط (27 · 7 · 0) — فالوقتُ موجودٌ في التاريخ لا في العدّاد.
//   • و`Log → System Log`: أحدثُ سطرٍ فيه `2026-08-21 23:16:03` والساعةُ الحقيقيّةُ في
//     بغداد وقتَها `23:34 (+03:00)` ⇒ **توقيتُ الساس هو توقيتُ بغداد** لا UTC.
//
// 🔴 **والعلّةُ التي كشفها هذا القياس**: `new Date("2026-09-17 17:00:00")` على خادمٍ بـUTC
//   تُنتج `17:00Z` — فالأرقامُ تُحفَظ صحيحةً و**المنطقةُ مُزاحةٌ ٣ ساعات**. ولأنّ العرضَ
//   كان بالأيّام فقط بقي الخللُ مستوراً، إلّا لمن وقتُ انتهائه `21:00` فما فوق فكان يظهر
//   **بيومٍ زائد** (٥ من كلّ ٣٠٠ في القياس).
//
// ✅ **وقرارُ محمد**: «صحّحه بالعرض فقط» — ولا تُمَسّ القاعدة، لأنّ قسماً من التواريخ
//   **يحسبه البرنامجُ لا الساس** (تعذُّرُ جلب الانتهاء بعد التفعيل)، فطرحُ ٣ ساعاتٍ من
//   الجميع دفعةً واحدةً كان سيُفسد تلك.
//
// ⇒ **القاعدةُ الواحدة**: أرقامُ المخزَّن بالـUTC هي أرقامُ ساعةِ بغداد كما يعرضها الساس.
//   فالعرضُ يقرأ `getUTC*` (فتُطابق الساسَ حرفيّاً)، والحسابُ يطرح ٣ ساعاتٍ ليصل إلى
//   اللحظة الحقيقيّة.
//
// ⚠️ **ولا تُستعمل هذه الدوالُّ إلّا لتاريخِ انتهاء الاشتراك** (`subscriber.dateTo` ·
//   `sasDateTo` · `dateTo` الوصل) — أمّا ما يكتبه البرنامجُ بنفسه (وقتُ التفعيل · تاريخُ
//   الوصل · انتهاءُ القرض الافتراضيّ) فلحظاتٌ حقيقيّةٌ تبقى على `formatDate`/`formatDateTime`.
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

function asDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return isNaN(x.getTime()) ? null : x;
}

/** اللحظةُ الحقيقيّةُ لانتهاء الاشتراك (المخزَّنُ أرقامُ بغداد ⇒ اللحظةُ أقدمُ بثلاث ساعات) */
export function expiryInstant(d: Date | string | null | undefined): Date | null {
  const x = asDate(d);
  return x ? new Date(x.getTime() - BAGHDAD_OFFSET_MS) : null;
}

/** تاريخُ الانتهاء بساعته ودقيقته كما يعرضه الساسُ حرفيّاً — `17/09/2026 17:00` */
export function formatExpiry(d: Date | string | null | undefined): string {
  const x = asDate(d);
  if (!x) return "—";
  const dd = String(x.getUTCDate()).padStart(2, "0");
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = x.getUTCFullYear();
  const hh = String(x.getUTCHours()).padStart(2, "0");
  const mi = String(x.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

/**
 * كما `formatExpiry` لكن يعيد نصّاً **فارغاً** عند الغياب لا «—».
 * تُستعمل في الرسائل حصراً: القوالبُ تُبنى بمتغيّرٍ داخل جملة، فوصولُ «—» إلى المشترك
 * أسوأُ من فراغٍ — وهذا هو سلوكُ الرسائل قبل إضافة الساعة، فلم يتغيّر منه شيء.
 */
export function formatExpiryOrEmpty(d: Date | string | null | undefined): string {
  const s = formatExpiry(d);
  return s === "—" ? "" : s;
}

/**
 * لحظةٌ حقيقيّةٌ (يكتبها البرنامجُ لا الساس) بتوقيت بغداد **صراحةً** — يومٌ وساعةٌ ودقيقة.
 * ولماذا لا `formatDateTime`؟ لأنّ تلك تقرأ توقيتَ الجهاز، وهذه تُستدعى على **الخادم**
 * وتوقيتُه UTC — فكانت ستُنقص ٣ ساعاتٍ من كلّ رسالة. وتعيد فراغاً عند الغياب (سياقُ رسالة).
 */
export function formatBaghdadDateTime(d: Date | string | null | undefined): string {
  const x = asDate(d);
  if (!x) return "";
  const b = new Date(x.getTime() + BAGHDAD_OFFSET_MS);
  const dd = String(b.getUTCDate()).padStart(2, "0");
  const mm = String(b.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(b.getUTCHours()).padStart(2, "0");
  const mi = String(b.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${b.getUTCFullYear()} ${hh}:${mi}`;
}

/** تاريخُ الانتهاء بلا وقت — لمواضعَ ضيّقةٍ لا تتّسع للساعة (بنفس قاعدة القراءة) */
export function formatExpiryDay(d: Date | string | null | undefined): string {
  const s = formatExpiry(d);
  return s === "—" ? s : s.slice(0, 10);
}

export type Remaining = {
  /** انتهى اشتراكُه (الفارقُ سالب) */
  negative: boolean;
  days: number;
  hours: number;
  minutes: number;
  /** الفارقُ بالمللي ثانية بإشارته — للتلوين والمقارنات */
  ms: number;
};

/** المتبقّي بدقّةٍ حقيقيّة: يومٌ وساعةٌ ودقيقة (لا فرقَ تقاويمَ بين منتصفَي ليل) */
export function remaining(d: Date | string | null | undefined, now: Date = new Date()): Remaining | null {
  const inst = expiryInstant(d);
  if (!inst) return null;
  const ms = inst.getTime() - now.getTime();
  const abs = Math.abs(ms);
  return {
    negative: ms < 0,
    days: Math.floor(abs / 86_400_000),
    hours: Math.floor((abs % 86_400_000) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
    ms,
  };
}

/**
 * نصُّ المتبقّي — **دائماً يومٌ وساعةٌ ودقيقة** (إملاءُ محمد 2026-08-21)، ومنتهٍ ⇒ بإشارة «−».
 * مثال: `5 ي 3 س 20 د`.
 */
export function remainingText(d: Date | string | null | undefined, now: Date = new Date()): string {
  const r = remaining(d, now);
  if (!r) return "—";
  return `${r.negative ? "−" : ""}${r.days} ي ${r.hours} س ${r.minutes} د`;
}
