// اختبار SMTP: يقرأ SMTP_* من البيئة ويرسل رسالةَ تجربة. لا يطبع كلمةَ السرّ.
// الاستعمال على الخادم: node --env-file=.env scripts/test-smtp.mjs recipient@example.com
import nodemailer from "nodemailer";

const to = process.argv[2];
if (!to) {
  console.error("الاستعمال: node --env-file=.env scripts/test-smtp.mjs <إيميل المستلم>");
  process.exit(1);
}
const { SMTP_USER, SMTP_PASS, SMTP_HOST = "smtp.gmail.com", SMTP_PORT = "587", SMTP_FROM } = process.env;
if (!SMTP_USER || !SMTP_PASS) {
  console.error("❌ لم تُضبط SMTP_USER / SMTP_PASS في .env");
  process.exit(1);
}
const port = Number(SMTP_PORT);
const t = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});
try {
  await t.verify();
  const info = await t.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: "اختبار SMTP — SHAKEEB",
    text: "نجح إعدادُ SMTP على خادمك. هذه رسالةُ تجربة — نسخُ النظام والوكلاء ستُرسَل من هنا.",
  });
  console.log("✅ نجح الإرسال:", info.messageId, "→", to);
} catch (e) {
  console.error("❌ فشل الإرسال:", e && e.message ? e.message : e);
  process.exit(1);
}
