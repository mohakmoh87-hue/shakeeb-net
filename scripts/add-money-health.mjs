#!/usr/bin/env node
/**
 * «سلامة المال» · جدولُ التجاهل — إضافةٌ صافيةٌ لا تُغيّر سلوكاً.
 * ويُعاد تشغيلُه بأمان. والعزلُ: GRANT + سياسةُ RLS كنمط بقيّة الجداول (بـ`current_agent_id()`).
 *   node scripts/add-money-health.mjs            (فحص)
 *   node scripts/add-money-health.mjs --apply
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
const APPLY = process.argv.includes("--apply");
function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const p = `${process.env.USERPROFILE ?? ""}/OneDrive/Desktop/حقيبة النجاة/secrets-railway.env`;
  const l = readFileSync(p, "utf8").split(/\r?\n/).find((x) => x.startsWith("DATABASE_PUBLIC_URL="));
  const u = l.slice("DATABASE_PUBLIC_URL=".length).trim();
  return u + (u.includes("?") ? "&" : "?") + "sslmode=no-verify";
}
const c = new pg.Client({ connectionString: dbUrl() });
await c.connect();
const exists = (await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name='money_health_ignores'`)).rowCount > 0;
console.log(`\n${APPLY ? "🔧 تنفيذ" : "🔍 فحص"} — جدول money_health_ignores: ${exists ? "موجود" : "غير موجود"}\n`);
if (!APPLY) { await c.end(); process.exit(0); }
for (const sql of [
  `CREATE TABLE IF NOT EXISTS money_health_ignores (
     id serial PRIMARY KEY, "agentId" integer NOT NULL,
     "checkKey" text NOT NULL, "rowKey" text NOT NULL,
     note text, "byUser" text,
     "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS money_health_ignores_key ON money_health_ignores ("agentId","checkKey","rowKey")`,
  `CREATE INDEX IF NOT EXISTS money_health_ignores_agent ON money_health_ignores ("agentId")`,
  `ALTER TABLE money_health_ignores ENABLE ROW LEVEL SECURITY`,
  `GRANT SELECT, INSERT, DELETE ON money_health_ignores TO agent_worker`,
  `GRANT USAGE, SELECT ON SEQUENCE money_health_ignores_id_seq TO agent_worker`,
  `DROP POLICY IF EXISTS rls_money_health_ignores ON money_health_ignores`,
  `CREATE POLICY rls_money_health_ignores ON money_health_ignores USING ("agentId" = current_agent_id())`,
]) { try { await c.query(sql); } catch (e) { console.log(`  ⚠️ ${String(e.message).slice(0, 100)}`); } }
console.log("✓ الجدولُ والفهارسُ والعزل");
console.table((await c.query(`SELECT policyname FROM pg_policies WHERE tablename='money_health_ignores'`)).rows);
console.table((await c.query(`SELECT privilege_type FROM information_schema.role_table_grants
  WHERE table_name='money_health_ignores' AND grantee='agent_worker' ORDER BY 1`)).rows);
await c.end();
console.log("\n✅ تمّ\n");
