
// طبقة المراسلة: تدعم SMS / واتساب / تيليغرام
// حالياً "محاكاة" (mock) — لتفعيل مزوّد حقيقي عدّل sendViaProvider أدناه.

export type Channel = "SMS" | "WHATSAPP" | "TELEGRAM";

// استبدال المتغيّرات في القالب ببيانات المشترك
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
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
