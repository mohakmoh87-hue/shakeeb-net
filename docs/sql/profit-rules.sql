-- ═════ 📈 أرباحُ الشركة — تهيئةُ القاعدة (طلبُ محمد 2026-08-22) ═════
-- إضافةٌ محضةٌ آمنة: جدولٌ جديدٌ وعمودٌ جديدٌ فارغُ القيمة. لا يحذف شيئاً ولا يغيّر صفّاً
-- ولا يمسّ مالاً. والميزةُ **خامدةٌ** حتى يُلصَق هذا السطر (الشاشةُ تقول ذلك صراحةً).
--
-- الصقه كما هو في قاعدة الإنتاج (Railway → Postgres → Query) مرّةً واحدة.

-- ١· جدولُ قواعد الربح — ثلاثُ طبقاتٍ ترث: الكابينة ← المكتب ← العامّ
--    (صفرٌ لا NULL في مفاتيح النطاق: بوستكرس يعدّ الـNULLات مختلفةً فينهار الفهرسُ الفريد)
CREATE TABLE IF NOT EXISTS "profit_rules" (
  "id"        SERIAL PRIMARY KEY,
  "agentId"   INTEGER NOT NULL,
  "towerId"   INTEGER NOT NULL DEFAULT 0,   -- 0 = عامٌّ لكلّ المكاتب
  "cabinet"   INTEGER NOT NULL DEFAULT 0,   -- 0 = كلُّ كابينات النطاق · رقمٌ = كابينةٌ بعينها
  "kind"      TEXT    NOT NULL,             -- act | instIn | instExt | deduct
  "packageId" INTEGER NOT NULL DEFAULT 0,   -- 0 = صفُّ النمط (للتفعيل بالنسبة)
  "mode"      TEXT,                         -- percent | fixed
  "percent"   DOUBLE PRECISION,
  "amount"    INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "profit_rules_scope_key"
  ON "profit_rules" ("agentId", "towerId", "cabinet", "kind", "packageId");
CREATE INDEX IF NOT EXISTS "profit_rules_agentId_idx" ON "profit_rules" ("agentId");

-- ٢· عمودُ «الانتهاء قبل التفعيلة» في سجلّ المزامنة — به تُعرَف مدّةُ التفعيل الخارجيّ
--    بالأشهر يقيناً لا تقديراً. فارغٌ للصفوف القديمة، ويُملأ من الآن فصاعداً.
ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "oldSasDateTo" TIMESTAMP(3);

-- ٣· عزلُ الصفوف (RLS) — كبقيّة جداول الوكلاء، فلا يرى وكيلٌ قواعدَ غيرِه أبداً
ALTER TABLE profit_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_profit_rules ON profit_rules;
CREATE POLICY rls_profit_rules ON profit_rules TO agent_worker
  USING ("agentId" = current_agent_id())
  WITH CHECK ("agentId" = current_agent_id());

-- ٤· للتحقّق بعد اللصق (يجب أن يعيد صفّاً واحداً لكلٍّ منهما):
-- SELECT to_regclass('public.profit_rules');
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'sync_log' AND column_name = 'oldSasDateTo';
