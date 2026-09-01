// ===== Web Push للفنيّ: push_subscriptions.technicianId + userId nullable =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-push-tech-col.mjs
//
// إضافيٌّ خالص (شبكةُ أمانٍ للتعافي — النشرُ لا يُشغّل migrate). ADD COLUMN مثاليُّ التكرار،
// وDROP NOT NULL توسيعٌ آمنٌ (الصفوفُ القائمةُ تحتفظ بـuserId؛ لا كودَ حيٌّ يُنشئ صفّاً بلا userId).
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  await c.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS "technicianId" INTEGER`);
  await c.query(`ALTER TABLE push_subscriptions ALTER COLUMN "userId" DROP NOT NULL`);
  await c.query(`CREATE INDEX IF NOT EXISTS "push_subscriptions_technicianId_idx" ON push_subscriptions ("technicianId")`);
  console.log("✅ push_subscriptions.technicianId + userId nullable + index جاهز");
} finally { await c.end(); }
