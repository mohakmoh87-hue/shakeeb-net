// ===== ب-١/الأصل ١ · إجارةُ القيادة =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-leader-lease.mjs
//
// 🔴 كانت القيادةُ **مُشتقّةً** من `hybrid_workers.lastSeen`: كلُّ حاسبةٍ تحسبها لنفسها
//   كلَّ ٢٠ ثانية. متّفقةٌ في الاستقرار، لكنّ لحظةَ الانتقال (تعطُّلُ القائد ثمّ عودتُه)
//   تسمح بأن تَرى حاسبتان نفسَيهما قائدتَين ⇒ استضافةُ الواتساب مرّتَين على الجلسة
//   نفسِها (فتُفقَد) وتنفيذُ مهامّ القائد مرّتَين.
// ⇒ عمودان على `agents` يُنتزَعان بمقارنةٍ-وتبديلٍ ذرّيّة: مالكٌ ومهلة.
//   والأولويّةُ تبقى هي مَن يُحدّد **المستحقَّ** (فلا يُهدَر ضبطُ محمد)، والإجارةُ
//   تُحدّد **المالكَ فعلاً**. إضافيّان واختياريّان ⇒ نشرةٌ أقدمُ حيّةٌ لا تتأثّر.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  for (const [col, type] of [["leaderMachineId", "TEXT"], ["leaderUntil", "TIMESTAMP(3)"]]) {
    const has = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='agents' AND column_name=$1`, [col],
    );
    if (has.rowCount) console.log(`✓ ${col} موجودٌ سلفاً`);
    else { await c.query(`ALTER TABLE agents ADD COLUMN "${col}" ${type}`); console.log(`✅ أُضيف ${col}`); }
  }
  // العاملُ يُجدّد الإجارةَ ⇒ يحتاج UPDATE على `agents`. نقيسه ولا نخمّنه.
  const g = await c.query(
    `SELECT grantee, string_agg(privilege_type,',' ORDER BY privilege_type) pr
       FROM information_schema.role_table_grants WHERE table_name='agents' GROUP BY grantee ORDER BY grantee`,
  );
  for (const r of g.rows) console.log("  • GRANT", r.grantee, "→", r.pr);
  const p = await c.query(`SELECT policyname, cmd, qual FROM pg_policies WHERE tablename='agents'`);
  for (const r of p.rows) console.log("  • سياسة", r.policyname, `[${r.cmd}]`, (r.qual || "").slice(0, 70));
  const n = await c.query(`SELECT COUNT(*) n FROM agents WHERE "isDeleted"=false`);
  const w = await c.query(
    `SELECT "agentId", COUNT(*) n FROM hybrid_workers WHERE approved=true AND "agentId" IS NOT NULL
      GROUP BY 1 HAVING COUNT(*)>1 ORDER BY n DESC`,
  );
  console.log("  • وكلاءُ النظام:", n.rows[0].n);
  console.log("  • وكلاءُ لهم أكثرُ من حاسبةٍ معتمدة (وهم مَن يمسّهم هذا الأصل):",
    w.rowCount, w.rows.map((r) => `وكيل ${r.agentId}×${r.n}`).join(" · ") || "—");
} finally { await c.end(); }
