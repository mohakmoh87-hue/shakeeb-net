
// طبقة المراسلة: تدعم SMS / واتساب / تيليغرام
// حالياً "محاكاة" (mock) — لتفعيل مزوّد حقيقي عدّل sendViaProvider أدناه.

export type Channel = "SMS" | "WHATSAPP" | "TELEGRAM";

// أسماء عربية للمتغيّرات — تُشتق قيمها تلقائياً من نظيراتها الإنكليزية إن لم تُمرَّر صراحةً،
// فتدعم كل مواضع الإرسال القائمة قوالبَ بمتغيّرات عربية ({اسم_المشترك}...) بلا أي تعديل عليها.
const ARABIC_ALIASES: [string, string][] = [
  ["package", "نوع_الباقة"],
  ["card", "البطاقة"],
  ["netUser", "اسم_المستخدم"],
  ["name", "اسم_المشترك"],
  ["price", "مبلغ_الاشتراك"],
  ["paid", "المبلغ_المستلم"],
  ["remaining", "المبلغ_المتبقي"],
  ["carry", "اجمالي_الديون"],
  ["dateTo", "تاريخ_الانتهاء"],
  ["code", "كود_الخصم"],        // كود خصم/مكافأة المشترك (يبقى فارغاً لمن لا رصيد له)
  ["balance", "رصيد_المكافأة"], // رصيد مكافأة المشترك المتراكم
  ["sale", "المبيع"],           // مبلغ مبيع المواد في إنجاز البطاقة (الصافي)
  ["subscription", "الاشتراك"], // مبلغ الاشتراك المستلم مع البطاقة (معلوماتي)
  ["address", "العنوان"],       // «ادرس 1» من الساس — يظهر فقط إن أدخله المدير في القالب
];

// استبدال المتغيّرات في القالب ببيانات المشترك (يدعم الأسماء الإنكليزية والعربية معاً)
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  const all: Record<string, string | number | null | undefined> = { ...vars };
  for (const [en, ar] of ARABIC_ALIASES) {
    if (all[ar] === undefined && vars[en] !== undefined) all[ar] = vars[en];
  }
  // ═════ 💰 «لا مبلغَ لمن لا باقةَ له» — قاعدةُ محمد 2026-08-21 (تسري على كلّ رسالة) ═════
  // نصُّه: «عند إرسال رسالة انتهاء اشتراكٍ أو أيّ رسالةٍ أخرى لمشتركٍ ليس لديه باقة فلا
  // يُرسَل له مبلغُ الاشتراك أبداً حتى وإن كان محدَّداً في القالب — كي لا يصله مبلغٌ صفر».
  // فالسطرُ الحاملُ للمتغيّر **يُنزَع كاملاً** (لا يُترَك «مبلغ الاشتراك : » فارغاً)، وذلك
  // حين تكون القيمةُ غائبةً أو صفراً — ومصدرُها سعرُ الباقة، فمن بلا باقةٍ بلا سعر.
  // 🔒 وهذا الموضعُ هو **المعبرُ الوحيدُ** لكلّ القوالب (تفعيل · انتهاء · ملخّص · سجلّ
  //    المزامنة · المكافآت…) فالقاعدةُ تسري على الجميع بلا تكرارِ منطقٍ في كلّ مُرسِل.
  const priceKeys = ["price", "مبلغ_الاشتراك"];
  const priceMissing = priceKeys.every((k) => {
    const v = all[k];
    if (v === null || v === undefined || String(v).trim() === "") return true;
    const n = Number(String(v).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) && n <= 0;
  });
  const body = priceMissing
    ? template.split("\n").filter((line) => !priceKeys.some((k) => line.includes(`{${k}}`))).join("\n")
    : template;
  return body.replace(/\{([\w؀-ۿ]+)\}/g, (_, key) => {
    const v = all[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

// ═════ 🖼️ سببُ سقوط الصورة — يُكتَب في سجلّ الرسائل لكلّ قالبٍ لا لقالبَين ═════
// (بلاغُ محمد 2026-08-21: «الصورةُ لا تصل، والرسالةُ تصل»). كان `imageError` يُوثَّق في
// مسارَين اثنَين فقط من تسعة (التفعيل والملخّص)، فبقيّةُ القوالب تسقط صورتُها **بلا
// أثرٍ يُقرأ** — فيتعذّر معرفةُ السبب عن بُعد. وهذه دالّةٌ **مضافةٌ لا تُغيّر شيئاً**:
// نجاحٌ بلا صورةٍ ⇒ `null` كما كان تماماً، ونجاحٌ سقطت صورتُه ⇒ نصُّ السبب.
export function imageNote(res: { error?: string; imageError?: string }): string | null {
  if (res.error) return res.error;
  return res.imageError ? `أُرسلت بلا صورة — ${res.imageError}` : null;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  /** وصلت الرسالةُ بلا صورةٍ وهذا سببُه (تُوثَّق في سجلّ الرسائل — لا في نافذة الحاسبة وحدَها) */
  imageError?: string;
  /** وصلت بصورتها */
  withImage?: boolean;
}

// نقطة التوصيل بمزوّد حقيقي (Twilio / واتساب API / بوت تيليغرام)
// المتغيّر MESSAGING_PROVIDER يحدّد المزوّد؛ الافتراضي "mock".
export async function sendViaProvider(
  channel: Channel,
  phone: string | null,
  text: string,
  officeId?: number | null, // مكتب المشترك (لاختيار جلسة واتساب المكتب)
  // البند ٣ · صورةُ القالب (data URI) — تُرسَل مع النصّ **تعليقاً واحداً** لا رسالتَين
  image?: string | null,
  // ═════ 🚦 مسارُ البوّابة (طلبُ محمد 2026-08-25) ═════
  // الافتراضيُّ `urgent` **عمداً**: كلُّ المسارات التي يطلبها إنسانٌ الآن (تفعيل · تسديد ·
  // إنجازُ بطاقة · ملخّص · مكافأة · قرض · زرُّ إرسال) تبقى **بلا تعديلِ حرفٍ واحد**، ولا
  // يُصرّح بـ`bulk` إلّا الدفعاتُ الستُّ التي تعمل في الخلفيّة. فالخطأُ بالنسيان يقع في
  // الجانب الآمن: رسالةٌ تأخذ الأولويّةَ، لا رسالةُ إنسانٍ تنتظر خلف بثٍّ من ألفَين.
  lane: "urgent" | "bulk" = "urgent",
): Promise<SendResult> {
  if (!phone) return { ok: false, error: "لا يوجد رقم هاتف" };

  // واتساب: إرسال من جلسة واتساب المكتب التابع له المشترك
  if (channel === "WHATSAPP") {
    const { sendWhatsApp } = await import("@/lib/whatsapp");
    return sendWhatsApp(officeId, phone, text, image, lane);
  }

  // SMS / تيليغرام: محاكاة حتى ربط مزوّد حقيقي
  return { ok: true };
}
