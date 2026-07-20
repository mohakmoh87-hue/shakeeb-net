
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
  return template.replace(/\{([\w؀-ۿ]+)\}/g, (_, key) => {
    const v = all[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

// نقطة التوصيل بمزوّد حقيقي (Twilio / واتساب API / بوت تيليغرام)
// المتغيّر MESSAGING_PROVIDER يحدّد المزوّد؛ الافتراضي "mock".
export async function sendViaProvider(
  channel: Channel,
  phone: string | null,
  text: string,
  officeId?: number | null, // مكتب المشترك (لاختيار جلسة واتساب المكتب)
): Promise<SendResult> {
  if (!phone) return { ok: false, error: "لا يوجد رقم هاتف" };

  // واتساب: إرسال من جلسة واتساب المكتب التابع له المشترك
  if (channel === "WHATSAPP") {
    const { sendWhatsApp } = await import("@/lib/whatsapp");
    return sendWhatsApp(officeId, phone, text);
  }

  // SMS / تيليغرام: محاكاة حتى ربط مزوّد حقيقي
  return { ok: true };
}
