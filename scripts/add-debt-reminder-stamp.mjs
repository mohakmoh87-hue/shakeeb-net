// ===== ب-١/الأصل ٢ · ختمُ يومِ رسائل الديون =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-debt-reminder-stamp.mjs
//
// 🔴 رسائلُ الديون اليوميّة كانت **بلا ختمِ يومٍ إطلاقاً**، والمُجدولُ يُطلقها على
//   تطابقِ الدقيقة ⇒ حاسبتان لوكيلٍ واحدٍ تُرسلان لكلّ مَدينٍ **مرّتَين**.
// ⇒ عمودٌ يُحجَز به اليومُ ذرّيّاً **قبل** أوّل رسالة. إضافيٌّ واختياريّ فنشرةٌ أقدمُ
//   حيّةٌ لا تعرفه ولا تتأثّر به. ولا يُملأ رجعيّاً: تركُه `null` يعني أنّ رسائلَ اليوم
//   قد تُرسَل مرّةً واحدةً بعد النشر — وهو المطلوب، فالختمُ حَجزٌ لا سجلّ.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const has = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='towers' AND column_name='lastDebtReminderDate'`,
  );
  if (has.rowCount) console.log("✓ العمودُ موجودٌ سلفاً");
  else {
    await c.query(`ALTER TABLE towers ADD COLUMN "lastDebtReminderDate" TEXT`);
    console.log('✅ أُضيف العمود "lastDebtReminderDate"');
  }
  const g = await c.query(
    `SELECT grantee, string_agg(privilege_type,',' ORDER BY privilege_type) pr
       FROM information_schema.role_table_grants WHERE table_name='towers' GROUP BY grantee ORDER BY grantee`,
  );
  for (const r of g.rows) console.log("  • GRANT", r.grantee, "→", r.pr);
  const p = await c.query(`SELECT policyname, cmd FROM pg_policies WHERE tablename='towers'`);
  console.log("  • سياساتُ العزل:", p.rows.map((r) => `${r.policyname}[${r.cmd}]`).join(" · ") || "⚠️ لا سياسة!");
  const n = await c.query(`SELECT COUNT(*) n FROM towers WHERE "debtReminderEnabled"='1' AND "isDeleted"=false`);
  console.log("  • مكاتبُ رسائل الديون المفعَّلة:", n.rows[0].n);
} finally { await c.end(); }
