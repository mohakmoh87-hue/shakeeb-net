// ═════ 🩺 سجلُّ الفحص — جدولا `diag_checks` و`asn_cache` (طلبُ محمد 2026-11-22) ═════
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-diag-checks.mjs
//
// إضافةٌ محضة: جدولان جديدان وفهرسان، ولا مساسَ بجدولٍ قائم.
// 🔑 ويُنفَّذ **قبل** نشر الكود: Prisma تطلب الجدولَ في أوّل نداءٍ للمسار الجديد،
//    فلو غاب لسقط المسارُ وحدَه (وأسوأُ منه أن يُنشَر ثمّ يُنسى الجدول).
// 🔒 وRLS تُشعَل على الجدولَين كنظائرهما: الموقعُ مالكُ الجداول فيتجاوزها، وحاسبةُ
//    المكتب بلا GRANT أصلاً فلا تصل — والسياسةُ عزلٌ بالوكيل دفاعاً في العمق.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log("═══ سجلُّ الفحص ═══\n");

  await c.query(`CREATE TABLE IF NOT EXISTS "diag_checks" (
    "id" SERIAL PRIMARY KEY,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phoneCore" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "subscriberId" INTEGER,
    "appAccountId" INTEGER,
    "towerId" INTEGER,
    "agentId" INTEGER,
    "ip" TEXT,
    "asn" INTEGER,
    "ispName" TEXT,
    "onSuperCell" BOOLEAN,
    "pkgMbps" DOUBLE PRECISION,
    "routerPingMs" DOUBLE PRECISION,
    "netPingMs" DOUBLE PRECISION,
    "linkMbps" DOUBLE PRECISION,
    "downMbps" DOUBLE PRECISION,
    "upMbps" DOUBLE PRECISION,
    "opticRx" DOUBLE PRECISION,
    "opticErr" TEXT,
    "opticDiag" TEXT,
    "devices" INTEGER,
    "deviceDiag" TEXT,
    "summary" TEXT,
    "verdict" TEXT,
    "stages" JSONB,
    "refRaw" TEXT,
    "appVersion" TEXT,
    "platform" TEXT
  )`);
  await c.query(`ALTER TABLE "diag_checks" ADD COLUMN IF NOT EXISTS "opticDiag" TEXT`);
  console.log("✅ diag_checks");

  await c.query(`CREATE INDEX IF NOT EXISTS "diag_checks_phoneCore_createdAt_idx" ON "diag_checks" ("phoneCore", "createdAt")`);
  await c.query(`CREATE INDEX IF NOT EXISTS "diag_checks_subscriberId_createdAt_idx" ON "diag_checks" ("subscriberId", "createdAt")`);
  console.log("✅ فهرسا الهاتف والمشترك");

  await c.query(`CREATE TABLE IF NOT EXISTS "asn_cache" (
    "prefix" TEXT PRIMARY KEY,
    "asn" INTEGER,
    "holder" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log("✅ asn_cache");

  await c.query(`ALTER TABLE "diag_checks" ENABLE ROW LEVEL SECURITY`);
  await c.query(`DROP POLICY IF EXISTS rls_diag_checks ON "diag_checks"`);
  await c.query(`CREATE POLICY rls_diag_checks ON "diag_checks" TO agent_worker
    USING ("agentId" = current_agent_id()) WITH CHECK ("agentId" = current_agent_id())`);
  await c.query(`ALTER TABLE "asn_cache" ENABLE ROW LEVEL SECURITY`);
  await c.query(`GRANT SELECT ON "diag_checks" TO agent_worker`);
  console.log("✅ RLS + GRANT SELECT لحاسبة المكتب (قراءةً فقط)");

  const n = await c.query(`SELECT count(*)::int AS n FROM "diag_checks"`);
  console.log(`\nالصفوفُ الآن: ${n.rows[0].n}`);
} finally {
  await c.end();
}
