// ===== إذنُ العامل على `agents.odooSlaSendAllowed` — إنهاءُ عطبٍ حيٍّ في الإنتاج =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/grant-odoo-sla-col.mjs
//
// 🔴 **العطبُ مقيسٌ لا مُستنتَج** (سجلُّ Railway، 2026-08-15): يتكرّر ~٣ مرّاتٍ في الدقيقة
//    على مدار الساعة منذ أيّام:
//
//      ERROR: permission denied for table agents
//      STATEMENT: SELECT "agents"."id", "agents"."odooSlaSendAllowed" FROM "agents" …
//
//    المصدر: `sendAllowedFor()` في `src/lib/odooSync.ts` — تُنادى على **حاسبة المكتب**
//    (دور `agent_worker`) قبل كلّ إرسالِ رسالةِ أودو. ودورُ العامل يملك `SELECT` على
//    **أعمدةٍ بعينها** من `agents` لا على الجدول، و`odooSlaSendAllowed` لم يُدرَج فيها
//    حين أُضيفت ميزةُ مهلة أودو ⇒ خرقٌ لقاعدة المستودع: «كتابةٌ/قراءةٌ جديدة = GRANT + سياسة».
//
// 🔇 **ولماذا لم يُلاحَظ؟** لأنّ الاستدعاء ملفوفٌ بـ`catch { v = false }` — «فشلٌ مغلق»
//    (وهو الصوابُ أمنيّاً: تعذُّرُ التحقّق من الإذن يجب ألّا يفتح الإرسال). فالنتيجة:
//    **ميزةُ رسائل أودو التلقائيّة لا يمكن أن تعمل من حاسبات المكاتب أبداً**، مهما أشعلها
//    مالكُ النظام — بلا رسالةِ خطأٍ واحدةٍ في الواجهة. الميزةُ نائمةٌ فلم يشتكِ أحد.
//
// 🔒 **ولا يُوسَّع العزل بذرّة**: الممنوحُ قراءةُ رايةٍ منطقيّةٍ واحدة، وسياسةُ `rls_agents`
//    تبقى كما هي — تقصر الصفوفَ المرئيّةَ على وكيل الحاسبة نفسِه. فلا يرى وكيلٌ رايةَ آخر.
//
// ♻️ ويُعاد تشغيلُه بلا ضرر: `GRANT` عمليّةٌ متساويةُ النتيجة (idempotent).

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");

const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }

const c = new Client({
  connectionString: url,
  ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }),
});
await c.connect();

try {
  // كلُّ أدوار عمّال الوكلاء (agent_worker هو الدورُ الأب الذي ترثه أدوارُ الوكلاء)
  const roles = await c.query(
    `SELECT rolname FROM pg_roles WHERE rolname = 'agent_worker' OR rolname LIKE 'agent\\_%\\_worker'`
  );
  if (!roles.rows.length) { console.error("⛔ لا دورَ عاملٍ في هذه القاعدة"); process.exit(1); }

  console.log("— قبل المنح —");
  const before = await c.query(
    `SELECT grantee, string_agg(column_name, ', ' ORDER BY column_name) AS cols
       FROM information_schema.column_privileges
      WHERE table_name = 'agents' AND column_name = 'odooSlaSendAllowed'
      GROUP BY grantee ORDER BY grantee`
  );
  console.log(before.rows.length ? before.rows : "  (لا أحدَ يملك العمود)");

  await c.query(`GRANT SELECT ("odooSlaSendAllowed") ON agents TO agent_worker`);
  console.log('✓ مُنح SELECT("odooSlaSendAllowed") على agents للدور agent_worker');

  console.log("— بعد المنح —");
  const after = await c.query(
    `SELECT grantee, string_agg(column_name, ', ' ORDER BY column_name) AS cols
       FROM information_schema.column_privileges
      WHERE table_name = 'agents' AND column_name = 'odooSlaSendAllowed'
      GROUP BY grantee ORDER BY grantee`
  );
  console.log(after.rows);

  // إثباتُ الأثر: القراءةُ نفسُها بدور العامل — تنجح أم ما زالت تُرفَض؟
  // (تُجرَّب داخل معاملةٍ تُلغى، فلا يبقى أثرٌ ولا يتغيّر دورُ الجلسة بعدها.)
  const roleName = roles.rows.find((r) => r.rolname !== "agent_worker")?.rolname ?? "agent_worker";
  await c.query("BEGIN");
  try {
    await c.query(`SET LOCAL ROLE ${JSON.stringify(roleName).replace(/"/g, '"')}`);
    await c.query(`SELECT id, "odooSlaSendAllowed" FROM agents LIMIT 1`);
    console.log(`✅ التحقّق: الدور ${roleName} صار يقرأ العمود بلا رفض`);
  } catch (e) {
    console.error(`⚠️ ما زالت القراءةُ مرفوضةً بالدور ${roleName}: ${e.message}`);
  } finally {
    await c.query("ROLLBACK");
  }
} finally {
  await c.end();
}
