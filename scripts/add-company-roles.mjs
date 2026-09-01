// ===== أدوار سوبر سيل: company_users.role (مدير/موظف) + parentId =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-company-roles.mjs
//
// إضافيٌّ خالص (شبكةُ أمانٍ للتعافي — النشرُ لا يُشغّل migrate؛ ويُضاف كسولاً في ensureCompanyUsersTable).
// role الافتراضُ 'manager' فكلُّ حسابٍ قائمٍ يبقى مديراً. مثاليُّ التكرار (IF NOT EXISTS).
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  await c.query(`ALTER TABLE company_users ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'manager'`);
  await c.query(`ALTER TABLE company_users ADD COLUMN IF NOT EXISTS "parentId" INTEGER`);
  console.log("✅ company_users.role + parentId جاهزان");
} finally { await c.end(); }
