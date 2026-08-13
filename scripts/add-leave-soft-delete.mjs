// ===== أ-٨ · إزالةُ إجازةٍ أُدخلت خطأً — سجلٌّ لا محو =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-leave-soft-delete.mjs
//
// 🔴 كان النظامُ **بلا `DELETE`** على الإجازات: `PATCH` يقبل/يرفض المعلَّقةَ وحدَها ويردّ
//   «الطلبُ مُقرَّرٌ مسبقاً» لما بعدها ⇒ إجازةٌ اعتُمدت خطأً تبقى إلى الأبد ومعها يومٌ
//   مدفوعٌ في راتب الفنيّ.
// ⇒ ثلاثةُ أعمدةٍ إضافيّةٍ اختياريّة: الإزالةُ ناعمةٌ ومَن أزالها ومتى مكتوبان.
//   ونشرةٌ أقدمُ حيّةٌ لا تعرفها ولا تتأثّر (بريزما تُسمّي أعمدتها صريحةً في SELECT).
//
// 🔒 وGRANT: العاملُ المحليُّ **يقرأ** الإجازات (`autoAssign` يستبعد فنيّاً في إجازة،
//   و`salary` يحتسبها) ولا يكتبها من مسارٍ خلفيّ — لكنّ درسَ اليوم أنّ دورَ العامل
//   يملك SELECT على **أعمدةٍ بعينها** لا على الجدول، **وبريزما تقرأ الصفَّ كاملاً**
//   في بعض العمليّات. فيُمنَح SELECT على الأعمدة الجديدة صريحاً، ويُقاس الناتج.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const cols = [["isDeleted", "BOOLEAN NOT NULL DEFAULT false"], ["deletedBy", "TEXT"], ["deletedAt", "TIMESTAMP(3)"]];
  for (const [col, type] of cols) {
    const has = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name=$1`, [col],
    );
    if (has.rowCount) console.log(`✓ ${col} موجودٌ سلفاً`);
    else { await c.query(`ALTER TABLE leaves ADD COLUMN "${col}" ${type}`); console.log(`✅ أُضيف ${col}`); }
  }

  // صلاحيّاتُ العامل: نقيسها ثمّ نُكمل الناقصَ — ولا نُخمّن
  const g = await c.query(
    `SELECT column_name FROM information_schema.column_privileges
      WHERE table_name='leaves' AND grantee='agent_worker' AND privilege_type='SELECT' ORDER BY 1`,
  );
  const granted = new Set(g.rows.map((r) => r.column_name));
  const tableWide = await c.query(
    `SELECT 1 FROM information_schema.role_table_grants
      WHERE table_name='leaves' AND grantee='agent_worker' AND privilege_type='SELECT'`,
  );
  if (tableWide.rowCount) {
    console.log("✓ للعامل SELECT على **الجدول كلِّه** ⇒ الأعمدةُ الجديدة مشمولةٌ تلقائيّاً");
  } else if (granted.size) {
    console.log(`ℹ️ للعامل SELECT على ${granted.size} عموداً بعينها ⇒ نمنحه الأعمدةَ الجديدة`);
    await c.query(`GRANT SELECT ("isDeleted","deletedBy","deletedAt") ON leaves TO agent_worker`);
    console.log("✅ GRANT SELECT على الأعمدة الثلاثة");
  } else {
    console.log("ℹ️ لا SELECT للعامل على leaves إطلاقاً — لا شيءَ يُمنَح (لا يقرؤها بدوره)");
  }

  const p = await c.query(`SELECT policyname, cmd FROM pg_policies WHERE tablename='leaves'`);
  console.log("── سياساتُ العزل:", p.rows.map((r) => `${r.policyname}[${r.cmd}]`).join(" · ") || "⚠️ لا سياسة!");
  const n = await c.query(`SELECT COUNT(*) n, COUNT(*) FILTER (WHERE "salaryStatementId" IS NOT NULL) stamped FROM leaves`);
  console.log(`── إجازاتٌ في القاعدة: ${n.rows[0].n} · منها مختومةٌ بكشفِ راتب: ${n.rows[0].stamped} (لا تُزال)`);
} finally { await c.end(); }
