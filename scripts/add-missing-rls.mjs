// ═════ 🔒 سدُّ ثلاثِ سياساتٍ ناقصةٍ اصطادها اختبارُ التغطية (2026-08-14) ═════
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-missing-rls.mjs
//
// ⚠️ **ولا يُغيَّر عملٌ قائم**: الثلاثةُ **بلا أيّ إذنٍ للعامل** (قِيس: صفرُ GRANT)،
//   فتشغيلُ RLS عليها لا يمنع قراءةً موجودةً — يسدُّ البابَ قبل أوّلِ كتابةٍ منه.
//   وهي التي يُبلّغ عنها `npm run check:money` منذ اليوم.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  for (const t of ["managers", "card_completions", "map_point_proposals"]) {
    // 🔒 وتحقّقٌ قبل الأثر: إن كان للعامل إذنٌ على الجدول فالتشغيلُ يُخفي صفوفاً
    //   فجأةً ⇒ يُتخطّى ويُبلَّغ، ولا يُقرَّر عن محمد في أمرٍ يمسّ عملَ المكاتب.
    const gr = await c.query(
      `SELECT DISTINCT privilege_type FROM information_schema.table_privileges
        WHERE table_name = $1 AND grantee LIKE 'agent%'`, [t]);
    if (gr.rowCount) {
      console.log(`⚠️ ${t}: للعامل ${gr.rows.map((r) => r.privilege_type).join(",")} — يُتخطّى (تشغيلُ RLS قد يُخفي صفوفاً)`);
      continue;
    }
    await c.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    await c.query(`DROP POLICY IF EXISTS rls_${t} ON ${t}`);
    await c.query(`CREATE POLICY rls_${t} ON ${t} TO agent_worker
      USING ("agentId" = current_agent_id()) WITH CHECK ("agentId" = current_agent_id())`);
    console.log(`✅ ${t}: RLS + سياسةُ agentId`);
  }
  const r = await c.query(`
    SELECT c.relname tbl, c.relrowsecurity rls,
           (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname)::int pol
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false
       AND EXISTS (SELECT 1 FROM information_schema.columns k
                    WHERE k.table_name = c.relname AND k.column_name = 'agentId')`);
  console.log(`\n🔍 جداولُ agentId بلا RLS الآن: ${r.rowCount}`);
  for (const x of r.rows) console.log("  •", x.tbl);
} finally { await c.end(); }
