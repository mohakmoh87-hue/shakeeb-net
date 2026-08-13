// ═════ البند ٤-ب · ختمُ رسالة «فعّل بنفسه» (طلبُ محمد 2026-08-13) ═════
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-self-act-notice.mjs
//
// 🔴 **والردمُ هنا ألزمُ منه في ٤-أ**: المزامنةُ تقرأ تفعيلاتِ الأمس في **كلّ دورة**، وكلُّ
//   تفعيلٍ مُفعِّلُه ليس حسابَ المكتب يُرسَل له. فلو بدأ العمودُ فارغاً لأُرسلت رسالةٌ لكلّ
//   مَن فعّل بنفسه أمسِ — دفعةً واحدةً في أوّل دورةٍ بعد النشر.
//   ⇒ فيُختَم **كلُّ** مشتركٍ بتاريخ انتهائه الحاليّ: «أُبلِغ عن تفعيله الحاليّ سلفاً».
//     فلا يُرسَل إلّا عند تفعيلٍ **جديدٍ** يُنتج تاريخاً مختلفاً — وهو عينُ المطلوب.
//
// 🔑 والقيمةُ **تاريخُ الانتهاء** لا لحظةُ الردم: الختمُ يُقارَن بتاريخ التفعيل الناتج،
//   فلو رُدم بـ`NOW()` لَبدا كلُّ تفعيلٍ قادمٍ «مختلفاً» بلا معنى، أو لَسكت عن الصحيح.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log("═══ البند ٤-ب · ختمُ «فعّل بنفسه» ═══\n");

  const had = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='subscribers' AND column_name='selfActNoticeAt'`);
  if (had.rowCount) {
    console.log("• العمودُ موجودٌ سابقاً — **ولا ردمَ** (لو رُدم ثانيةً لأُسكِت مشتركون ينتظرون رسالتَهم بحقّ)");
  } else {
    await c.query(`ALTER TABLE subscribers ADD COLUMN "selfActNoticeAt" TIMESTAMP(3)`);
    console.log("✅ أُضيف subscribers.selfActNoticeAt TIMESTAMP(3)");
    // 🛡️ الردم: كلُّ مشتركٍ له تاريخُ انتهاءٍ يُختَم **بتاريخه هو**
    const r = await c.query(
      `UPDATE subscribers SET "selfActNoticeAt" = "dateTo"
        WHERE "isDeleted"=false AND "dateTo" IS NOT NULL AND "selfActNoticeAt" IS NULL`);
    console.log(`\n🛡️ الردم: ${r.rowCount} مشتركاً خُتم بتاريخ انتهائه الحاليّ`);
    console.log("   ⇒ فلا رسالةَ إلّا عند تفعيلٍ **جديد** يُنتج تاريخاً مختلفاً — ولا رشقةَ في أوّل دورة.");
  }

  // الأذون: العاملُ يُشغّل المزامنةَ ⇒ يحتاج قراءةَ الختم وكتابتَه
  const rows = (await c.query(
    `SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
      WHERE table_name='subscribers' AND grantee LIKE 'agent%'`)).rows;
  const byRole = new Map();
  for (const r of rows) {
    const k = `${r.grantee}|${r.privilege_type}`;
    if (!byRole.has(k)) byRole.set(k, new Set());
    byRole.get(k).add(r.column_name);
  }
  let granted = 0;
  for (const [k, have] of byRole) {
    const [role, priv] = k.split("|");
    if (!["SELECT", "UPDATE", "INSERT"].includes(priv)) continue;
    if (have.has("selfActNoticeAt")) continue;
    await c.query(`GRANT ${priv} ("selfActNoticeAt") ON subscribers TO "${role}"`);
    granted++;
  }
  console.log(`• مُنِح ${granted} إذنَ عمودٍ لأدوار الوكلاء`);

  const blind = await c.query(
    `SELECT DISTINCT g.grantee FROM information_schema.column_privileges g
      WHERE g.table_name='subscribers' AND g.grantee LIKE 'agent%' AND g.privilege_type='SELECT'
        AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges x
          WHERE x.table_name='subscribers' AND x.grantee=g.grantee
            AND x.privilege_type='SELECT' AND x.column_name='selfActNoticeAt')`);
  if (blind.rowCount) {
    console.log(`🔴 العمودُ أعمى في وجه: ${blind.rows.map((b) => b.grantee).join(", ")}`);
    process.exitCode = 1;
  } else console.log("🔒 العمودُ مرئيٌّ لكلّ دورٍ يقرأ الجدول");

  const st = await c.query(
    `SELECT count(*)::int AS all_subs, count("selfActNoticeAt")::int AS stamped,
            count(*) FILTER (WHERE "dateTo" IS NULL)::int AS no_date
       FROM subscribers WHERE "isDeleted"=false`);
  console.log(`\n• المشتركون: ${st.rows[0].all_subs} · مختومون: ${st.rows[0].stamped} · بلا تاريخِ انتهاء: ${st.rows[0].no_date}`);
  console.log("  (ومَن بلا تاريخٍ لا يُختَم — ولا يُرسَل له إلّا حين يُنتج تفعيلٌ تاريخاً)");
} catch (e) {
  console.error("🔴", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
