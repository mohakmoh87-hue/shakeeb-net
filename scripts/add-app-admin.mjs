// ===== أدمن تطبيق المشترك: جدول app_admins + عمودا subscribers.appBanned / lastAppLoginAt =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-app-admin.mjs
//
// إضافيٌّ خالص (شبكةُ أمانٍ للتعافي/الإعداد الجديد — النشرُ لا يُشغّل migrate). النشرُ الحيُّ طُبِّق
// عليه هذا يدويّاً قبل الكود؛ هذا السكربتُ يجعله دائماً. مثاليٌّ التكرار (IF NOT EXISTS).
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  await c.query(`
    CREATE TABLE IF NOT EXISTS "app_admins" (
      "id" SERIAL PRIMARY KEY,
      "username" TEXT NOT NULL UNIQUE,
      "password" TEXT NOT NULL,
      "plainPassword" TEXT,
      "sessionToken" TEXT,
      "isDeleted" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  console.log("✅ app_admins جاهز");
  await c.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS "appBanned" BOOLEAN NOT NULL DEFAULT false`);
  await c.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS "lastAppLoginAt" TIMESTAMP(3)`);
  console.log("✅ subscribers.appBanned + lastAppLoginAt جاهزان");
} finally { await c.end(); }
