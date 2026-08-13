// ===== تنظيفُ جلسات واتسابٍ لمكاتبَ محذوفة (تدقيقُ 2026-08-13) =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/clean-orphan-wa-sessions.mjs [--apply]
//
// 🔴 وُجد صفُّ جلسةٍ بحالة `qr` لمكتبٍ **محذوف** (شكيب/المواصلات ٣) بلا مضيفٍ إطلاقاً.
//   فأيُّ عدٍّ يقرأ الجلساتِ بدل المكاتب يُحصيه «غير متصل» أبداً، وأيُّ عاملٍ يقرؤه قد
//   يُشغّل له متصفّحاً بلا داعٍ.
// 🔒 ولا يُحذَف الصفُّ بل **يُنطَفأ**: حذفُ صفٍّ يُفقد أثرَ ما كان، والإطفاءُ يكفي —
//   والبرنامجُ صار يمنع إحياءَه (`startWhatsApp` ترفض المحذوفَ ومَن لا يحتاجه أحد).

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const apply = process.argv.includes("--apply");
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const rows = await c.query(
    `SELECT w."towerId", t.name, t."isDeleted", t."waEnabled", t."managerPhone" IS NOT NULL has_mgr, w.state
       FROM wa_sessions w LEFT JOIN towers t ON t.id = w."towerId"
      WHERE t.id IS NULL OR t."isDeleted" = true
         OR (t."waEnabled" = '0' AND t."managerPhone" IS NULL)`,
  );
  console.log(`── جلساتٌ لا يحتاجها أحد: ${rows.rowCount}`);
  for (const r of rows.rows) {
    const why = r.isDeleted == null ? "المكتبُ غيرُ موجود" : r.isDeleted ? "المكتبُ محذوف" : "مُطفأٌ ولا رقمَ مدير";
    console.log(`   مكتب ${r.towerId} · ${r.name ?? "—"} · ${why} · حالتُها: ${r.state}`);
  }
  if (!rows.rowCount) { console.log("✓ لا شيءَ يُنظَّف"); }
  else if (!apply) { console.log("\n(عرضٌ فقط — أضِف --apply للتنفيذ)"); }
  else {
    const ids = rows.rows.map((r) => r.towerId);
    const u = await c.query(
      `UPDATE wa_sessions SET state='disconnected', qr=NULL, error='المكتبُ محذوفٌ أو لا يحتاج واتساب'
        WHERE "towerId" = ANY($1::int[])`, [ids],
    );
    console.log(`✅ أُطفئت ${u.rowCount} جلسة (بلا حذفِ صفّ — الأثرُ يبقى)`);
  }
} finally { await c.end(); }
