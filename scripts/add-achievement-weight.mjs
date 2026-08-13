// ===== نقاطُ الإنجاز لكلّ فئة: إضافةُ العمود إلى قاعدة الإنتاج =====
//
//   DATABASE_URL="postgres://…?sslmode=no-verify" node scripts/add-achievement-weight.mjs
//
// طلبُ محمد 2026-08-13: «أن يقوم المديرُ بإعطاء نقاطٍ لكلّ فئةٍ حسب ما يرغب، **ويمكن أن
// يكون صفراً**، لمتابعة إنجازات الفنيّين.»
//
// ⚠️ **الترتيبُ حرِج: هذا السكربتُ يُشغَّل قبل النشر لا بعده.** فـPrisma يُسمّي الأعمدةَ
// صريحاً في `SELECT`، ولو نُشِر الكودُ قبل وجود العمود لسقطت شاشةُ الإنجازات وشاشةُ أنواع
// البطاقات على كلّ الوكلاء. والإضافةُ آمنةٌ على النشر القائم: عمودٌ جديدٌ لا يقرؤه أحدٌ بعدُ.
//
// ولا يحتاج GRANT ولا سياسةَ RLS جديدة: هذا **عمودٌ في جدولٍ قائم** لا جدولٌ جديد،
// وصلاحيّاتُ `card_types` ممنوحةٌ على مستوى الجدول فتشمل الأعمدةَ المستقبليّة — والسكربتُ
// يتحقّق من ذلك ويُنبِّه لو وجدها ممنوحةً على أعمدةٍ بعينها.
//
// يُعاد تشغيلُه بلا ضرر (idempotent).
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const c = new Client({ connectionString: url });

async function main() {
  await c.connect();
  const q = async (s, p = []) => (await c.query(s, p)).rows;

  const [{ exists }] = await q(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='card_types' AND column_name='achievementWeight') AS exists`);

  if (exists) {
    console.log("ℹ️  العمودُ موجودٌ مسبقاً — لا تغيير");
  } else {
    await c.query(`ALTER TABLE card_types ADD COLUMN "achievementWeight" double precision`);
    console.log("✅ أُضيف العمود `achievementWeight` (double precision, NULL مسموح)");
  }

  // فحصُ الصلاحيّات: لو كانت ممنوحةً على أعمدةٍ بعينها فالعمودُ الجديد **لا** يُشمل
  const tableGrants = await q(`
    SELECT DISTINCT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_name='card_types' AND grantee <> current_user ORDER BY grantee, privilege_type`);
  console.log("\n— صلاحيّاتُ الجدول (تشمل الأعمدةَ الجديدة تلقائياً):");
  for (const g of tableGrants) console.log(`   ${g.grantee}: ${g.privilege_type}`);
  if (!tableGrants.length) console.log("   (لا شيء — الوصولُ بحساب المالك وحده)");

  const colOnly = await q(`
    SELECT DISTINCT grantee FROM information_schema.column_privileges
    WHERE table_name='card_types' AND grantee <> current_user
      AND grantee NOT IN (SELECT grantee FROM information_schema.role_table_grants WHERE table_name='card_types')`);
  if (colOnly.length) {
    console.log("\n🔴 تحذير: هذه الأدوارُ ممنوحةٌ على أعمدةٍ بعينها فلن ترى العمودَ الجديد:");
    for (const g of colOnly) console.log(`   ${g.grantee}  ⇒ يلزمها GRANT صريحٌ على "achievementWeight"`);
  }

  // النتيجة
  const [n] = await q(`
    SELECT count(*)::int AS types, count("achievementWeight")::int AS configured
    FROM card_types WHERE "isDeleted"=false`);
  console.log(`\n— الفئاتُ الحيّة: ${n.types} · منها مضبوطةٌ يدويّاً: ${n.configured}`);
  console.log("  (الفارغةُ تُحسَب بأوزانها المبنيّة كما كانت — فلا يتغيّر شيءٌ على أحد)");

  await c.end();
}

main().catch(async (e) => { console.error("🔴", e.message); await c.end().catch(() => {}); process.exit(1); });
