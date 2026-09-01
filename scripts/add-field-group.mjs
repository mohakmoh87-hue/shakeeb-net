// ===== مجموعة لوحة الفنيين: task_cards.officeId + towers.sharedFieldWith =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-field-group.mjs
//
// إضافيٌّ خالص (شبكةُ أمانٍ للتعافي/الإعداد الجديد — النشرُ لا يُشغّل migrate). officeId = مكتبُ
// البطاقة الماليّ (null ⇒ سلوكُ اليوم)، sharedFieldWith = مكتبٌ رئيسيٌّ لمشاركة اللوحة (null ⇒ مستقلّ).
// النشرُ الحيُّ طُبِّق عليه هذا يدويّاً قبل الكود؛ هذا يجعله دائماً. مثاليٌّ التكرار (IF NOT EXISTS).
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  await c.query(`ALTER TABLE task_cards ADD COLUMN IF NOT EXISTS "officeId" INTEGER`);
  await c.query(`ALTER TABLE towers ADD COLUMN IF NOT EXISTS "sharedFieldWith" INTEGER`);
  console.log("✅ task_cards.officeId + towers.sharedFieldWith جاهزان");
} finally { await c.end(); }
