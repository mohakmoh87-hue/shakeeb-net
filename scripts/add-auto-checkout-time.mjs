// ═════ عمود وقت الخروج التلقائي لكلّ فنيّ + مقعد إشعار المالك (2026-08-20) ═════
//
//   DATABASE_URL="postgres://…?sslmode=no-verify" node scripts/add-auto-checkout-time.mjs
//
// ⚠️ الترتيبُ حرِج: يُشغَّل **قبل** نشر الكود — بريزما تُسمّي `autoCheckoutTime` صراحةً في
// قراءات الفنيّين، فنشرُ الكود قبل العمود يُسقط صفحاتِ الفنيّين كلَّها.
// والإضافةُ آمنةٌ على النشرة القائمة (عمودٌ لا يقرؤه القديم) — درسُ db-changes-additive-only.
// DEFAULT '00:15' يطابق سلوكَ الكرون الليليّ القديم حرفيّاً لكلّ الفنيّين القائمين.
// لا GRANT جديد (عمودٌ في جدولٍ ممنوحٍ جدوليّاً) ولا سياسةَ RLS (ليس جدولاً جديداً).
// يُعاد تشغيلُه بلا ضرر (idempotent).
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }

const c = new Client({ connectionString: url });
await c.connect();
try {
  await c.query(`ALTER TABLE technicians ADD COLUMN IF NOT EXISTS "autoCheckoutTime" TEXT NOT NULL DEFAULT '00:15'`);
  console.log("✓ العمود technicians.autoCheckoutTime (افتراضيّ 00:15)");
  // مقعدُ إشعار نسخة درايف: يصل حسابَ المستخدم رقم 1 (shakeeb — محمد) وحدَه
  await c.query(`INSERT INTO system_settings (type, value)
    SELECT 'ownerNotifyUserId', '1'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE type='ownerNotifyUserId')`);
  console.log("✓ ownerNotifyUserId = 1 (إشعار درايف لحساب shakeeb وحدَه)");
} finally {
  await c.end();
}
