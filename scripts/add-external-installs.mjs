// ═════ البند ٥ · وسمُ «تنصيبات خارجية» (طلبُ محمد 2026-08-13/14) ═════
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-external-installs.mjs
//
// 🔴 **ولا ردمَ عن قصدٍ — وهذا لبُّ صحّة البند**: قِيس أنّ **١٩٤٩١** مشتركاً أنشأتهم
//   المزامنةُ (`createdByUser='sync'`)، وأكثرُهم استيرادُ النقل الأوّل لا تنصيبٌ حديثٌ
//   بلا علم. ولا `createdAt` على المشترك يُفرّق القديمَ من الجديد.
//   ⇒ فلو رُدم العمودُ لصارت القائمةُ ١٩٤٩١ صفّاً — **ضجيجٌ يُخفي الخبر** لا خبراً.
//   والقائمةُ تبدأ **فارغةً** وتُوسَم من أوّل مزامنةٍ بعد النشر: كلُّ صفٍّ فيها خبرٌ فعلاً.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log("═══ البند ٥ · وسمُ التنصيبات الخارجيّة ═══\n");
  for (const col of ["extInstallAt", "extIgnoredAt"]) {
    const has = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='subscribers' AND column_name=$1`, [col]);
    if (has.rowCount) { console.log(`• subscribers.${col} موجودٌ سابقاً`); continue; }
    await c.query(`ALTER TABLE subscribers ADD COLUMN "${col}" TIMESTAMP(3)`);
    console.log(`✅ أُضيف subscribers.${col} TIMESTAMP(3)`);
  }
  // فهرسٌ للقائمة: ترشيحٌ على (المكتب · مرصود · غيرُ متجاهَل) — يُقرأ عند كلّ فتحٍ للقائمة
  const idx = await c.query(`SELECT 1 FROM pg_indexes WHERE tablename='subscribers' AND indexname='subscribers_ext_install_idx'`);
  if (!idx.rowCount) {
    await c.query(`CREATE INDEX "subscribers_ext_install_idx" ON subscribers ("towerId", "extInstallAt") WHERE "extInstallAt" IS NOT NULL`);
    console.log("✅ أُضيف فهرسٌ جزئيٌّ للقائمة");
  } else console.log("• الفهرسُ موجودٌ سابقاً");

  // الأذون: المزامنةُ تعمل على **حاسبة المكتب** ⇒ دورُ العامل يكتب الوسمَ عند الإنشاء
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
    for (const col of ["extInstallAt", "extIgnoredAt"]) {
      if (have.has(col)) continue;
      await c.query(`GRANT ${priv} ("${col}") ON subscribers TO "${role}"`);
      granted++;
    }
  }
  console.log(`• مُنِح ${granted} إذنَ عمودٍ لأدوار الوكلاء`);

  const blind = await c.query(
    `SELECT DISTINCT g.grantee FROM information_schema.column_privileges g
      WHERE g.table_name='subscribers' AND g.grantee LIKE 'agent%' AND g.privilege_type='INSERT'
        AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges x
          WHERE x.table_name='subscribers' AND x.grantee=g.grantee
            AND x.privilege_type='INSERT' AND x.column_name='extInstallAt')`);
  if (blind.rowCount) {
    console.log(`🔴 العمودُ غيرُ قابلٍ للكتابة لـ: ${blind.rows.map((b) => b.grantee).join(", ")} — المزامنةُ على حاسبة المكتب ستفشل`);
    process.exitCode = 1;
  } else console.log("🔒 كلُّ دورٍ يُنشئ مشتركاً يستطيع كتابةَ الوسم");

  const st = await c.query(
    `SELECT count("extInstallAt")::int AS "موسومٌ الآن", count(*)::int AS "كلُّ المشتركين" FROM subscribers WHERE "isDeleted"=false`);
  console.table(st.rows);
  console.log("(«موسومٌ الآن» يجب أن يكون **صفراً** — القائمةُ تبدأ فارغةً بلا ردم)");
} catch (e) {
  console.error("🔴", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
