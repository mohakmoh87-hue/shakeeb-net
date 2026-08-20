// ═════ 📬 جدول الرسائل الداخليّة المنبثقة (طلب محمد — 2026-08-20) ═════
//
//   DATABASE_URL="postgres://…?sslmode=no-verify" node scripts/add-internal-messages.mjs
//
// جدولٌ جديدٌ كليّاً — إضافةٌ آمنةٌ على النشرة الحيّة (لا يقرؤه كودٌ قديم)، والمسارُ
// الجديدُ يتحمّل غيابَه (P2021 ⇒ فراغٌ هادئ) فالترتيبُ مع النشر غيرُ حرِج.
//
// لا GRANT ولا سياسةَ RLS: الجدولُ يقرؤه ويكتبه **الموقعُ وحدَه** (اتصال postgres) —
// حاسباتُ المكاتب (أدوار agent_worker) لا تمسّه إطلاقاً.
//
// يُعاد تشغيلُه بلا ضرر (idempotent).
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }

const c = new Client({ connectionString: url });
await c.connect();
try {
  await c.query(`CREATE TABLE IF NOT EXISTS internal_messages (
    id SERIAL PRIMARY KEY,
    "agentId" INTEGER NOT NULL,
    "fromUserId" INTEGER,
    "fromTechId" INTEGER,
    "toUserId" INTEGER,
    "toTechId" INTEGER,
    "fromName" TEXT NOT NULL,
    text TEXT NOT NULL,
    "replyToId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3)
  )`);
  console.log("✓ الجدول internal_messages");
  await c.query(`CREATE INDEX IF NOT EXISTS "internal_messages_toUserId_closedAt_idx" ON internal_messages ("toUserId","closedAt")`);
  await c.query(`CREATE INDEX IF NOT EXISTS "internal_messages_toTechId_closedAt_idx" ON internal_messages ("toTechId","closedAt")`);
  await c.query(`CREATE INDEX IF NOT EXISTS "internal_messages_fromUserId_idx" ON internal_messages ("fromUserId")`);
  console.log("✓ الفهارس الثلاثة");
  // العزل لا يكون مشروطاً: RLS من اليوم الأوّل وإن كان الموقعُ (postgres) قارئَه الوحيد
  await c.query(`ALTER TABLE internal_messages ENABLE ROW LEVEL SECURITY`);
  await c.query(`DROP POLICY IF EXISTS rls_internal_messages ON internal_messages`);
  await c.query(`CREATE POLICY rls_internal_messages ON internal_messages TO agent_worker
    USING ("agentId" = current_agent_id())
    WITH CHECK ("agentId" = current_agent_id())`);
  console.log("✓ RLS وسياسة agent_worker");
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM internal_messages`);
  console.log(`✓ تحقّق: الجدول يُقرأ (${rows[0].n} صفّاً)`);
} finally {
  await c.end();
}
