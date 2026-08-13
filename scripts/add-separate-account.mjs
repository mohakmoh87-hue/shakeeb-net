// ===== البند ١ · «حسابٌ منفصل» لمستخدمٍ يشارك مكتباً (طلبُ محمد 2026-08-13) =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-separate-account.mjs
//
// كان السلوكُ: **مكتبٌ فيه مستخدمان ⇒ كلٌّ يرى تقريرَ نفسِه** — فصلٌ إجباريٌّ بلا خيار.
// وطلبُ محمد أن يكون بمربّعٍ: «وإن لم أضع صحّاً فالاثنان يفعلان بنفس التقرير».
//
// 🔑 **والردمُ يحفظ السلوكَ القائمَ حرفيّاً**: يُوضَع `true` لمستخدمي المكاتب التي فيها
//   أكثرُ من مستخدمٍ نشِطٍ **اليوم** ⇒ صفرُ تغيُّرٍ على الإنتاج لحظةَ النشر، والمربّعُ
//   يصير هو المُتحكِّم بعدها. ولولا الردمُ لَانقلب مكتبٌ قائمٌ إلى تقريرٍ مشترَكٍ بلا علمِ أحد.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const has = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='separateAccount'`,
  );
  if (has.rowCount) console.log("✓ العمودُ موجودٌ سلفاً");
  else {
    await c.query(`ALTER TABLE users ADD COLUMN "separateAccount" BOOLEAN NOT NULL DEFAULT false`);
    console.log('✅ أُضيف "separateAccount"');
  }

  // الردمُ: مستخدمو المكاتب متعدّدةِ المستخدمين النشِطين ⇒ منفصلون (كما كانوا فعلاً)
  const back = await c.query(
    `UPDATE users u SET "separateAccount" = true
      WHERE u."isDeleted"=false AND u."isActive"=true AND u."towerId" IS NOT NULL
        AND u."separateAccount" = false
        AND (SELECT COUNT(*) FROM users x
              WHERE x."towerId" = u."towerId" AND x."isDeleted"=false AND x."isActive"=true) > 1`,
  );
  console.log(`✅ رُدم ${back.rowCount} مستخدماً (كانوا منفصلين فعلاً بحكم العدد) ⇒ صفرُ تغيُّر`);

  const st = await c.query(
    `SELECT t.name, COUNT(*) n, SUM(CASE WHEN u."separateAccount" THEN 1 ELSE 0 END) sep
       FROM users u JOIN towers t ON t.id=u."towerId"
      WHERE u."isDeleted"=false AND u."isActive"=true
      GROUP BY t.name HAVING COUNT(*)>1`,
  );
  for (const r of st.rows) console.log(`   مكتب ${r.name}: ${r.n} مستخدمين · منفصلون: ${r.sep}`);
} finally { await c.end(); }
