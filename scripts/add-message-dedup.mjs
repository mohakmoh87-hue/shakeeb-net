// ═════ حارسُ تكرار الرسائل: العمود + الفهرسُ الفريدُ الجزئيّ (طلبُ محمد 2026-08-19) ═════
//
//   DATABASE_URL="postgres://…?sslmode=no-verify" node scripts/add-message-dedup.mjs
//
// ⚠️ الترتيبُ حرِج: يُشغَّل **قبل** نشر الكود. فـPrisma يُسمّي `dedupKey` صراحةً في الإدراج،
// ولو نُشِر الكودُ قبل وجود العمود لسقط كلُّ إرسالِ رسالة. والإضافةُ آمنةٌ على النشر القائم:
// عمودٌ جديدٌ NULL لا يقرؤه أحدٌ بعد.
//
// والفهرسُ **جزئيٌّ** (WHERE dedupKey IS NOT NULL): الرسائلُ القديمةُ كلُّها بـNULL فخارجه،
// فلا تتصادم ولا يُعاد بناءُ شيء. ويحرس الجديدَ وحدَه: يستحيل صفّان بنفس المفتاح.
//
// لا يحتاج GRANT: `messages` ممنوحةٌ على مستوى الجدول (‏GRANT … ON messages) فيشمل العمودَ
// الجديد. ولا سياسةَ RLS جديدة: عمودٌ في جدولٍ قائمٍ لا جدولٌ جديد.
//
// يُعاد تشغيلُه بلا ضرر (idempotent).
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }

const c = new Client({ connectionString: url });
await c.connect();
try {
  await c.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "dedupKey" text`);
  console.log("✓ العمود dedupKey");
  await c.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS messages_dedupkey_uniq
       ON messages ("dedupKey") WHERE "dedupKey" IS NOT NULL`,
  );
  console.log("✓ الفهرسُ الفريدُ الجزئيّ messages_dedupkey_uniq");

  // تحقّقٌ: العمودُ والفهرسُ موجودان فعلاً
  const col = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='dedupKey'`,
  );
  const idx = await c.query(`SELECT 1 FROM pg_indexes WHERE indexname='messages_dedupkey_uniq'`);
  console.log(col.rowCount === 1 && idx.rowCount === 1 ? "✅ مؤكَّد: العمودُ والفهرسُ حاضران" : "⚠️ لم يتأكّد الإنشاء");
} finally {
  await c.end();
}
