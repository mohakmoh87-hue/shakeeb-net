// ===== أ-١٠ · عمودُ «أين بصم دخولَه» =====
//
//   DATABASE_URL="postgres://…?sslmode=no-verify" node scripts/add-checkin-tower.mjs
//
// القاعدةُ الحاكمة (قرار محمد 2026-08-11): «يستطيع بصمَ دخولٍ من مكتبٍ والخروجَ من مكتبٍ آخر،
// **وكلُّ الإجراءات ترجع إلى مكتبه الأصليّ وكأنّه بصم من مكتبه الأصليّ**.»
// ⇒ `attendances.towerId` = **المكتبُ الأصليُّ دائماً** (لمن يُحتسَب اليوم)، و`checkInTowerId`
// مع `checkOutTowerId` = **أين بصم فعلاً** (للشفافيّة). ونظيرُ الخروج موجودٌ أصلاً، فالناقصُ
// عمودُ الدخول وحدَه — **وهو العمودُ الجديد الوحيد في البند**.
//
// ⚠️ **يُشغَّل قبل النشر لا بعده** — Prisma يُسمّي الأعمدةَ صريحاً في SELECT، فنشرٌ بلا العمود
// يُسقط مسارَ الحضور كلَّه (بصماتُ الفنيّين وسجلُّ المدير). والإضافةُ آمنةٌ على النشر القائم:
// عمودٌ جديدٌ لا يقرؤه أحدٌ بعدُ.
//
// ولا GRANT ولا سياسةَ RLS جديدة: عمودٌ في جدولٍ قائمٍ وصلاحيّاتُه على مستوى الجدول —
// والسكربتُ يتحقّق ويُنبِّه لو وجدها ممنوحةً على أعمدةٍ بعينها.
//
// 🔎 **والتاريخُ لا يُنقَل** (القاعدة ٥): الصفوفُ القديمة تبقى بـ`checkInTowerId = NULL` ومعناه
// «بصم في مكتبه» — وقياسُ الإنتاج 2026-08-13 يُثبت أنّ هذا صحيحٌ لكلّ صفٍّ قائم: **صفرُ صفوفٍ**
// نُسبت لمكتبٍ غير مكتب صاحبها. فلا التزامَ ضمنيّاً يُخالف الواقع.
//
// يُعاد تشغيلُه بلا ضرر (idempotent).
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const c = new Client({ connectionString: url });

async function main() {
  await c.connect();
  const q = async (s) => (await c.query(s)).rows;

  const [{ exists }] = await q(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='attendances' AND column_name='checkInTowerId') AS exists`);

  if (exists) {
    console.log("ℹ️  العمودُ موجودٌ مسبقاً — لا تغيير");
  } else {
    await c.query(`ALTER TABLE attendances ADD COLUMN "checkInTowerId" integer`);
    console.log("✅ أُضيف العمود `checkInTowerId` (integer, NULL مسموح)");
  }

  const tableGrants = await q(`
    SELECT DISTINCT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_name='attendances' AND grantee <> current_user ORDER BY grantee, privilege_type`);
  console.log("\n— صلاحيّاتُ الجدول (تشمل الأعمدةَ الجديدة تلقائياً):");
  for (const g of tableGrants) console.log(`   ${g.grantee}: ${g.privilege_type}`);
  if (!tableGrants.length) console.log("   (لا شيء — الوصولُ بحساب المالك وحده)");

  const colOnly = await q(`
    SELECT DISTINCT grantee FROM information_schema.column_privileges
    WHERE table_name='attendances' AND grantee <> current_user
      AND grantee NOT IN (SELECT grantee FROM information_schema.role_table_grants WHERE table_name='attendances')`);
  if (colOnly.length) {
    console.log("\n🔴 تحذير: هذه الأدوارُ ممنوحةٌ على أعمدةٍ بعينها فلن ترى العمودَ الجديد:");
    for (const g of colOnly) console.log(`   ${g.grantee}  ⇒ يلزمها GRANT صريحٌ على "checkInTowerId"`);
  }

  // تحقُّقٌ من أنّ «NULL = بصم في مكتبه» صادقٌ على كلّ صفٍّ قائم
  const [n] = await q(`
    SELECT count(*)::int AS rows,
           count(*) FILTER (WHERE a."towerId" IS DISTINCT FROM t."towerId")::int AS mismatched
    FROM attendances a JOIN technicians t ON t.id = a."technicianId"`);
  console.log(`\n— صفوفُ الحضور: ${n.rows} · منها منسوبةٌ لمكتبٍ غيرِ مكتب صاحبها: ${n.mismatched}`);
  if (n.mismatched === 0) console.log("  ✅ فمعنى NULL («بصم في مكتبه») صادقٌ على التاريخ كلِّه");
  else console.log("  ⚠️ راجِع هذه الصفوف: معناها الضمنيُّ لا يُطابق مكتبَ صاحبها");

  await c.end();
}

main().catch(async (e) => { console.error("🔴", e.message); await c.end().catch(() => {}); process.exit(1); });
