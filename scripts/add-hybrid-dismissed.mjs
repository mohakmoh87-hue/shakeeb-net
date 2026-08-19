// ═════ صرفُ الحاسبة المحظورة: العمود dismissedAt (طلبُ محمد 2026-08-19) ═════
//
//   DATABASE_URL="postgres://…?sslmode=no-verify" node scripts/add-hybrid-dismissed.mjs
//
// ⚠️ يُشغَّل **قبل** نشر الكود (Prisma يُسمّي العمود صراحةً). آمنٌ على القائم: عمودٌ جديدٌ
// NULL لا يقرؤه أحد. لا GRANT: `hybrid_workers` ممنوحةٌ على مستوى الجدول. idempotent.
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }

const c = new Client({ connectionString: url });
await c.connect();
try {
  await c.query(`ALTER TABLE hybrid_workers ADD COLUMN IF NOT EXISTS "dismissedAt" timestamp(3)`);
  const col = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='hybrid_workers' AND column_name='dismissedAt'`,
  );
  console.log(col.rowCount === 1 ? "✅ العمود dismissedAt حاضر" : "⚠️ لم يتأكّد الإنشاء");
} finally {
  await c.end();
}
