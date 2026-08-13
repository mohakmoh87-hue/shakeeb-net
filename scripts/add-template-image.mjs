// ===== البند ٣ · صورةٌ ترافق رسائلَ القوالب (طلبُ محمد 2026-08-13) =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-template-image.mjs
//
// 🔑 **لماذا العمودُ نصٌّ لا مسارُ ملفّ**: الصورةُ تُخزَّن `data URI` بالـbase64 داخل الصفّ.
//   والسببُ بنيويٌّ لا تفضيليّ: السحابةُ (Railway) **بلا قرصٍ دائم** — ملفٌّ يُرفَع اليوم
//   يزول مع أوّل نشرة. والأخطرُ أنّ **المُرسِلَ حاسبةُ المكتب لا السحابة**، فمسارٌ محليٌّ
//   على السحابة لا وجودَ له على حاسبة المكتب أصلاً. والنصُّ يعبُر الاثنَين بلا وسيط.
//
// ⚠️ **والسقفُ إلزاميّ**: base64 يُضخّم ٣٣٪، والصفُّ يُقرأ في كلّ إرسال. السقفُ في الواجهة
//   ٣٠٠ كيلوبايت للملفّ الأصلي (≈٤٠٠ ألف حرفٍ في العمود) — يكفي شعاراً أو إعلاناً بوضوح.
//
// 🔒 **والأذونُ تُقاس لا تُفترَض**: أدوارُ `agent_<id>_worker` لها SELECT على **أعمدةٍ
//   بعينها** من `sms_templates` (فحاسبةُ المكتب تقرأ القالبَ عند الإرسال)، فعمودٌ جديدٌ
//   **غيرُ مرئيٍّ لها** حتى يُمنَح — وهذا بعينُه ما أذهب القيادةَ ساعةً وربعاً قبل أيّام.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log("═══ البند ٣ · عمودُ صورة القالب ═══\n");

  // ١) العمود
  const had = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='sms_templates' AND column_name='image'`,
  );
  if (had.rowCount) console.log("• العمودُ موجودٌ سابقاً — لا تغيير");
  else {
    await c.query(`ALTER TABLE sms_templates ADD COLUMN "image" TEXT`);
    console.log("✅ أُضيف العمود: sms_templates.image TEXT (يقبل NULL — والقوالبُ كلُّها بلا صورةٍ الآن)");
  }

  // ٢) قياسُ أذون الأعمدة القائمة لأدوار العاملين — نمنح العمودَ الجديد ما هو ممنوحٌ لغيره
  const roles = await c.query(
    `SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
      WHERE table_name='sms_templates' AND grantee LIKE 'agent%worker'`,
  );
  const byRole = new Map();
  for (const r of roles.rows) {
    const k = `${r.grantee}|${r.privilege_type}`;
    if (!byRole.has(k)) byRole.set(k, new Set());
    byRole.get(k).add(r.column_name);
  }
  console.log(`• أذونُ الأعمدة القائمة على sms_templates لأدوار العاملين: ${byRole.size} (دور×إذن)`);

  let granted = 0;
  for (const [k, cols] of byRole) {
    const [role, priv] = k.split("|");
    if (cols.has("image")) continue; // ممنوحٌ سلفاً (إذنُ جدولٍ شاملٌ يظهر على كلّ عمود)
    if (priv !== "SELECT" && priv !== "UPDATE" && priv !== "INSERT") continue;
    await c.query(`GRANT ${priv} ("image") ON sms_templates TO "${role}"`);
    granted++;
  }
  console.log(`✅ مُنِح إذنُ العمود الجديد في ${granted} موضعاً`);

  // ٣) تحقّقٌ نهائيّ: لا دورَ عاملٍ يقرأ الجدولَ ولا يرى العمودَ الجديد
  const blind = await c.query(
    `SELECT DISTINCT g.grantee FROM information_schema.column_privileges g
      WHERE g.table_name='sms_templates' AND g.grantee LIKE 'agent%worker' AND g.privilege_type='SELECT'
        AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges x
          WHERE x.table_name='sms_templates' AND x.grantee=g.grantee
            AND x.privilege_type='SELECT' AND x.column_name='image')`,
  );
  if (blind.rowCount) {
    console.log(`\n🔴 ${blind.rowCount} دورَ عاملٍ يقرأ الجدولَ والعمودُ أعمى في وجهه:`);
    for (const b of blind.rows) console.log("   -", b.grantee);
    process.exitCode = 1;
  } else console.log("🔒 لا دورَ عاملٍ يقرأ الجدولَ إلّا وهو يرى العمودَ الجديد — سليم");

  // ٤) صورةُ الحال
  const n = await c.query(`SELECT COUNT(*)::int AS c, COUNT("image")::int AS img FROM sms_templates`);
  console.log(`\n• القوالب: ${n.rows[0].c} صفّاً · بصورة: ${n.rows[0].img} (صفرٌ متوقَّعٌ الآن — لا سلوكَ تغيّر)`);
} catch (e) {
  console.error("🔴", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
