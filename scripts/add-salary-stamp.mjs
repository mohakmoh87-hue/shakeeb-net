// ===== (أ) · أعمدةُ «الوسمُ بدل الحذف» لسجلّ الراتب =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-salary-stamp.mjs
//
// قرارُ محمد 2026-08-13: «يلزمه أن يتوقّف التسديدُ عن الحذف النهائيّ ويُؤرشِف ما يحذف —
// فيُرجعه الإلغاءُ كاملاً **بأوقاته الحقيقيّة** لا مُعاداً بالدوام. وهذا يُصلح الجذرَ لا الأثر.»
//
// 🔴 والحادثة: سدّد المديرُ عمر راتبَ أحمد عبد الرزاق خطأً فألغاه — فظهر الكشفُ ملغىً ولم ترجع
// لا بصماتُه ولا راتبُه ولا ما سحبه. لأنّ التسديدَ كان يُنفّذ `deleteMany` على الحضور
// والخصومات والإجازات. والآن يُوسَم الصفُّ بمعرّف الكشف — **نمطُ `money_tx.salaryStatementId`
// القائمُ منذ البداية** — فلا يُعاد احتسابُه، ويفكُّ الإلغاءُ الوسمَ فيعود كلُّ شيء.
//
// ⚠️ **يُشغَّل قبل النشر لا بعده**: Prisma يُسمّي الأعمدةَ صريحاً في SELECT، ونشرٌ بلا الأعمدة
// يُسقط حسابَ الراتب كلَّه (شاشةُ الفنيّ · كشفُ المدير · التسديد · حسابات المدير).
// والإضافةُ آمنةٌ على النشر القائم: أعمدةٌ جديدةٌ لا يقرؤها أحدٌ بعدُ.
//
// ولا GRANT ولا سياسةَ RLS جديدة: أعمدةٌ في جداولَ قائمةٍ وصلاحيّاتُها على مستوى الجدول —
// والسكربتُ يتحقّق ويُنبِّه لو وجدها ممنوحةً على أعمدةٍ بعينها.
//
// يُعاد تشغيلُه بلا ضرر (idempotent).
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const c = new Client({ connectionString: url });

const TABLES = ["attendances", "adjustments", "leaves"];

async function main() {
  await c.connect();
  const q = async (s, p = []) => (await c.query(s, p)).rows;

  for (const t of TABLES) {
    const [{ exists }] = await q(`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name=$1 AND column_name='salaryStatementId') AS exists`, [t]);
    if (exists) {
      console.log(`ℹ️  ${t}: العمودُ موجودٌ مسبقاً`);
    } else {
      await c.query(`ALTER TABLE "${t}" ADD COLUMN "salaryStatementId" integer`);
      await c.query(`CREATE INDEX IF NOT EXISTS "${t}_salaryStatementId_idx" ON "${t}" ("salaryStatementId")`);
      console.log(`✅ ${t}: أُضيف العمود + فهرسُه`);
    }
  }

  console.log("\n— الصلاحيّاتُ (على مستوى الجدول ⇒ تشمل الأعمدةَ الجديدة):");
  for (const t of TABLES) {
    const g = await q(`
      SELECT DISTINCT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_name=$1 AND grantee <> current_user ORDER BY grantee, privilege_type`, [t]);
    console.log(`   ${t}: ${g.length ? g.map((x) => `${x.grantee}/${x.privilege_type}`).join(" · ") : "(المالكُ وحده)"}`);
    const colOnly = await q(`
      SELECT DISTINCT grantee FROM information_schema.column_privileges
      WHERE table_name=$1 AND grantee <> current_user
        AND grantee NOT IN (SELECT grantee FROM information_schema.role_table_grants WHERE table_name=$1)`, [t]);
    if (colOnly.length) console.log(`   🔴 ${t}: أدوارٌ ممنوحةٌ على أعمدةٍ بعينها لن ترى الجديد: ${colOnly.map((x) => x.grantee).join(", ")}`);
  }

  // ⚠️ **والصفوفُ القائمةُ تبقى `NULL` = «غيرُ مُسدَّدة» — وهذا صحيح**: كلُّ ما سُدِّد قبل اليوم
  // حُذف فعلاً، فما بقي غيرُ مُسدَّدٍ بالضرورة. فلا هجرةَ بياناتٍ ولا التزامَ كاذب.
  const [n] = await q(`
    SELECT (SELECT count(*)::int FROM attendances) AS att,
           (SELECT count(*)::int FROM adjustments) AS adj,
           (SELECT count(*)::int FROM leaves) AS lv`);
  console.log(`\n— الصفوفُ القائمة: ${n.att} بصمة · ${n.adj} خصم/مكافأة · ${n.lv} إجازة`);
  console.log("  وكلُّها NULL = «غيرُ مُسدَّدة» — وهو صحيحٌ لأنّ المُسدَّدَ قبل اليوم حُذف فعلاً");

  await c.end();
}

main().catch(async (e) => { console.error("🔴", e.message); await c.end().catch(() => {}); process.exit(1); });
