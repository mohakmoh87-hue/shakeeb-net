// ===== القروضُ تتبع لوحةَ الساس (طلبُ محمد 2026-08-13: «موقعَين للقروض») =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-panel-loan.mjs
//
// حسابُ القرض هو حسابُ **الديلر** على لوحة سوبر سيل، وكان على `Tower` وحدَه ⇒ مكتبٌ
// بلوحتَي ساسٍ له حسابُ ديلرٍ واحد. وقِيس أنّ لكلّ مُخدِّمِ ساسٍ حسابَ ديلرٍ مستقلّاً
// (صميم: `sameem.faaq@slm` و`Dajlat.Alsalam1@slm`) ⇒ القرضُ يتبع اللوحة.
//
// 🔑 و`loanEnabled`/`loanMode` تبقيان على المكتب: تلك **سياسةٌ** يقرّرها المكتبُ كوحدةِ
//   عمل، وهذه **بياناتُ دخولٍ** تتبع المُخدِّم. وفارغةٌ ⇒ يُرتدّ إلى أعمدة المكتب،
//   فالمكاتبُ الستّةُ المفعَّلةُ اليومَ (٥·٦·٧·٣٨·٣٩·٤٢) لا تتأثّر بحرف.
//
// 🔴 ودرسُ اليوم المُكلِّف: دورُ العامل يملك SELECT على **أعمدةٍ بعينها** لا على الجدول
//   في بعض الجداول، **وبريزما تقرأ الصفَّ كاملاً** في بعض العمليّات ⇒ عمودٌ جديدٌ بلا
//   GRANT يُسقط المسارَ بـ«permission denied» ورسالتُه على مستوى الجدول فتُضلّل.
//   فيُقاس هنا ولا يُخمَّن.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  for (const col of ["loanUser", "loanPass"]) {
    const has = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='sas_panels' AND column_name=$1`, [col],
    );
    if (has.rowCount) console.log(`✓ ${col} موجودٌ سلفاً`);
    else { await c.query(`ALTER TABLE sas_panels ADD COLUMN "${col}" TEXT`); console.log(`✅ أُضيف ${col}`); }
  }

  const tableWide = await c.query(
    `SELECT 1 FROM information_schema.role_table_grants
      WHERE table_name='sas_panels' AND grantee='agent_worker' AND privilege_type='SELECT'`,
  );
  const cols = await c.query(
    `SELECT COUNT(*) n FROM information_schema.column_privileges
      WHERE table_name='sas_panels' AND grantee='agent_worker' AND privilege_type='SELECT'`,
  );
  if (tableWide.rowCount) {
    console.log("✓ للعامل SELECT على **الجدول كلِّه** ⇒ العمودان مشمولان تلقائيّاً");
  } else if (Number(cols.rows[0].n) > 0) {
    await c.query(`GRANT SELECT ("loanUser","loanPass") ON sas_panels TO agent_worker`);
    console.log("✅ GRANT SELECT على العمودَين (الصلاحيّةُ بالأعمدة لا بالجدول)");
  } else {
    console.log("ℹ️ لا SELECT للعامل على sas_panels — لا شيءَ يُمنَح");
  }

  const p = await c.query(`SELECT policyname, cmd FROM pg_policies WHERE tablename='sas_panels'`);
  console.log("── سياساتُ العزل:", p.rows.map((r) => `${r.policyname}[${r.cmd}]`).join(" · ") || "⚠️ لا سياسة!");
  const st = await c.query(
    `SELECT t.id, t.name, t."loanEnabled", COUNT(sp.id) panels,
            COUNT(sp.id) FILTER (WHERE sp."loanUser" IS NOT NULL AND sp."loanUser" <> '') with_loan
       FROM towers t LEFT JOIN sas_panels sp ON sp."towerId"=t.id AND sp."isDeleted"=false
      WHERE t."isDeleted"=false GROUP BY t.id, t.name, t."loanEnabled" HAVING COUNT(sp.id) > 1`,
  );
  console.log("── مكاتبُ بأكثرَ من لوحة ──");
  for (const r of st.rows) {
    console.log(`  مكتب ${r.id} ${r.name} · لوحات: ${r.panels} · قروضُ المكتب: ${r.loanEnabled === "1" ? "مفعَّلة" : "مطفأة"}`
      + ` · لوحاتٌ لها حسابُ ديلر: ${r.with_loan}`);
  }
} finally { await c.end(); }
