// ═════ البند ٧ · أعمدةُ «مسحِ الخصم» (طلبُ محمد 2026-08-14) ═════
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-deduction-clear.mjs
//
// «يمكن للمدير مسحُ أيّ خصمٍ على موظّفٍ ولأيّ سبب وليس فقط البصمة.»
//
// 🔑 والمسحُ **سجلٌّ لا محوٌ**: مَن مسح ومتى ولماذا و**كم كان** — أربعةُ أعمدة. فبلا
//   `deductionClearedAmount` لا يُعرَف ما أُعفي عنه بعد أن صار الخصمُ صفراً، فيصير كشفُ
//   الراتب غيرَ قابلٍ للتفسير — وشرطُ محمد الدائم «ألّا يضيع شيء».
//
// ⛔ وقاعدةُ محمد: «إذا أُعطي الموظّفُ راتبَه فلن يُمسَح شيءٌ له بعدها» — محروسةٌ في
//   المسار (`salaryStatementId != null` ⇒ رفضٌ صريحٌ ٤٠٩)، ولا تحتاج عموداً.
//
// 🔒 ولا ردمَ هنا: الأعمدةُ فارغةٌ تعني «لم يُمسَح» — وهو الصحيحُ لكلّ صفٍّ قائم.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log("═══ البند ٧ · أعمدةُ مسحِ الخصم ═══\n");
  const cols = [
    ["deductionClearedBy", "TEXT"],
    ["deductionClearedAt", "TIMESTAMP(3)"],
    ["deductionClearReason", "TEXT"],
    ["deductionClearedAmount", "INTEGER"],
  ];
  for (const [col, type] of cols) {
    const has = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='attendances' AND column_name=$1`, [col]);
    if (has.rowCount) { console.log(`• attendances.${col} موجودٌ سابقاً`); continue; }
    await c.query(`ALTER TABLE attendances ADD COLUMN "${col}" ${type}`);
    console.log(`✅ أُضيف attendances.${col} ${type}`);
  }

  // الأذون: العاملُ يقرأ/يكتب صفوفَ الحضور (البصمُ والخروجُ الآليّ) ⇒ يُمنَح مثلَ غيره
  const rows = (await c.query(
    `SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
      WHERE table_name='attendances' AND grantee LIKE 'agent%'`)).rows;
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
    for (const [col] of cols) {
      if (have.has(col)) continue;
      await c.query(`GRANT ${priv} ("${col}") ON attendances TO "${role}"`);
      granted++;
    }
  }
  console.log(`\n• مُنِح ${granted} إذنَ عمودٍ لأدوار الوكلاء`);

  // تحقّقٌ: لا دورَ يقرأ الجدولَ والعمودُ أعمى في وجهه
  const blind = await c.query(
    `SELECT DISTINCT g.grantee FROM information_schema.column_privileges g
      WHERE g.table_name='attendances' AND g.grantee LIKE 'agent%' AND g.privilege_type='SELECT'
        AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges x
          WHERE x.table_name='attendances' AND x.grantee=g.grantee
            AND x.privilege_type='SELECT' AND x.column_name='deductionClearedAt')`);
  if (blind.rowCount) {
    console.log(`🔴 العمودُ أعمى في وجه: ${blind.rows.map((b) => b.grantee).join(", ")}`);
    process.exitCode = 1;
  } else console.log("🔒 الأعمدةُ مرئيّةٌ لكلّ دورٍ يقرأ الجدول");

  // صورةُ الحال: كم صفَّ حضورٍ عليه خصمٌ الآن، وكم منها مختومٌ بكشفٍ (لا يُمسَح)
  const st = await c.query(`
    SELECT count(*) FILTER (WHERE coalesce("lateDeduction",0)+coalesce("earlyDeduction",0) > 0)::int AS "عليه خصم",
           count(*) FILTER (WHERE coalesce("lateDeduction",0)+coalesce("earlyDeduction",0) > 0
                              AND "salaryStatementId" IS NOT NULL)::int AS "مختومٌ بكشف (لا يُمسَح)",
           count(*)::int AS "كلُّ الصفوف"
      FROM attendances`);
  console.table(st.rows);
} catch (e) {
  console.error("🔴", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
