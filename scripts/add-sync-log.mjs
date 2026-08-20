// ═════ 📋 جدول سجلّ المزامنة الموحَّد (ميزة محمد — 2026-08-20) ═════
//
//   DATABASE_URL="postgres://…?sslmode=no-verify" node scripts/add-sync-log.mjs
//
// جدولٌ جديدٌ كليّاً — إضافةٌ آمنة، والكودُ يتحمّل غيابَه (P2021 ⇒ خمولٌ هادئ) فترتيبُه
// مع النشر غيرُ حرِج. تكتبه المزامنةُ (من الموقع وحاسبات المكاتب) ويقرؤه الموقع.
// ⚠️ الحاسباتُ تكتب فيه بأدوار agent_worker ⇒ **GRANT + سياسة RLS واجبان** (قاعدة
// «كتابة جديدة = GRANT + سياسة» من ملف حاسبات المكاتب).
// يُعاد تشغيلُه بلا ضرر (idempotent).
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }

const c = new Client({ connectionString: url });
await c.connect();
try {
  await c.query(`CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    "agentId" INTEGER NOT NULL,
    "towerId" INTEGER NOT NULL,
    kind TEXT NOT NULL,
    "subscriberId" INTEGER,
    "sasId" INTEGER,
    "netUser" TEXT,
    name TEXT,
    phone TEXT,
    address TEXT,
    "packageName" TEXT,
    "sasDateTo" TIMESTAMP(3),
    amount INTEGER,
    "activatedAt" TIMESTAMP(3),
    changes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    snapshot TEXT,
    note TEXT,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log("✓ الجدول sync_log");
  await c.query(`CREATE INDEX IF NOT EXISTS "sync_log_towerId_kind_status_idx" ON sync_log ("towerId", kind, status)`);
  await c.query(`CREATE INDEX IF NOT EXISTS "sync_log_agentId_status_idx" ON sync_log ("agentId", status)`);
  await c.query(`CREATE INDEX IF NOT EXISTS "sync_log_sasId_kind_status_idx" ON sync_log ("sasId", kind, status)`);
  console.log("✓ الفهارس الثلاثة");
  // الحاسباتُ (المزامنةُ المحلّيّة) تكتب هنا بأدوار agent_worker ⇒ منحٌ وسياسةُ عزل
  await c.query(`GRANT SELECT, INSERT, UPDATE ON sync_log TO agent_worker`);
  await c.query(`GRANT USAGE, SELECT ON SEQUENCE sync_log_id_seq TO agent_worker`);
  await c.query(`ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY`);
  await c.query(`DROP POLICY IF EXISTS rls_sync_log ON sync_log`);
  await c.query(`CREATE POLICY rls_sync_log ON sync_log TO agent_worker
    USING ("agentId" = current_agent_id())
    WITH CHECK ("agentId" = current_agent_id())`);
  console.log("✓ GRANT + RLS لأدوار الحاسبات");
} finally {
  await c.end();
}
