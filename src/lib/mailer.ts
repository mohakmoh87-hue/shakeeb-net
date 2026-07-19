import nodemailer from "nodemailer";

// إرسال البريد عبر SMTP (Gmail افتراضياً). يُضبط بمتغيّرات البيئة:
//   SMTP_USER  = إيميل الحساب المُرسِل (مثال: yourname@gmail.com)
//   SMTP_PASS  = «كلمة مرور التطبيق» (App Password) المكوّنة من 16 حرفاً
//   SMTP_HOST  = smtp.gmail.com   (اختياري — هذه القيمة الافتراضية)
//   SMTP_PORT  = 587              (اختياري)
//   SMTP_FROM  = "SHAKEEB <yourname@gmail.com>"  (اختياري — الافتراضي SMTP_USER)
// إن لم تُضبط SMTP_USER/PASS يعمل النظام لكن دون إرسال فعلي (no-op) مع تسجيل تحذير.

export function mailerConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

let cached: nodemailer.Transporter | null = null;
function transport(): nodemailer.Transporter | null {
  if (!mailerConfigured()) return null;
  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT || 587);
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465, // 465 = SSL، 587 = STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return cached;
}

export type MailAttachment = { filename: string; content: Buffer | string; contentType?: string };

export async function sendMail(opts: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: MailAttachment[];
}): Promise<{ ok: boolean; error?: string }> {
  const t = transport();
  if (!t) return { ok: false, error: "لم تُضبط بيانات البريد (SMTP_USER/SMTP_PASS)" };
  try {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
    await t.sendMail({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html, attachments: opts.attachments });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذّر إرسال البريد" };
  }
}
