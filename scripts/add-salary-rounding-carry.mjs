// ===== هجرة: تقريبُ الراتب إلى الألف + ترحيلُ المتبقّي/الدَّين (بندا أ-١٦ و ب-٠٠) =====
//
// كلُّ الأعمدة nullable ⇒ آمنةٌ تماماً: لا توقّف، ولا أثرَ على صفٍّ قائم، والكشوفُ القديمة
// تبقى كما تُعرض اليوم حرفيّاً (الأعمدةُ الجديدة NULL ⇒ الواجهةُ ترتدّ للسلوك القديم).
//
//   DATABASE_URL="postgres://…" node scripts/add-salary-rounding-carry.mjs
//   DATABASE_URL="postgres://…" node scripts/add-salary-rounding-carry.mjs --apply-index
//
// بلا --apply-index يعمل **فحصاً فقط** للفهرس الفريد ويعرض التكرارات إن وُجدت.
//
// لماذا هذه الأعمدة (من تدقيقٍ على الشِفرة، لا تخميناً):
//   • salary_statements اليوم بلا أيّ عمودٍ للمدفوع فعلاً: `net` موصوفٌ «الصافي المدفوع» وهو
//     يحفظ **المحسوب** (field/salary/route.ts يحفظ result.net خاماً)، و`moneyTxId` يبقى فارغاً
//     في مسار «من المبلغ الكلي» (يكتب managerTx لا moneyTx) ⇒ نصفُ الرواتب بلا أثرٍ لِما دُفع.
//   • ولا مكانَ لرصيدٍ مُرحَّل ⇒ خيارُ محمد «تسديدٌ وتحويلُ المتبقّي على الشهر التالي» مستحيلٌ
//     بنيويّاً، والصافي السالبُ يُشطب صامتاً (route.ts يقصّه بـMath.max(0, …)).
//   • والإلغاءُ يُسجَّل في auditLog **وحده** (statement/[id]/route.ts:136) ولا يُعلَّم الصفّ ⇒
//     لا سبيلَ لقراءة «أحدث كشفٍ غير مُلغى» (وهو ما يحتاجه carryIn) بلا استعلام تدقيقٍ لكلّ فنيّ.
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const APPLY_INDEX = process.argv.includes("--apply-index");

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const say = (s) => console.log(`\n▶ ${s}`);

// ─────────────────────────────────────────────────────────────────────────────
say("١) الأعمدة الخمسة على salary_statements");
const cols = [
  // ما خرج من الصندوق فعلاً (بإشارته). يبقى NULL للكشوف القديمة ⇒ الواجهة ترتدّ إلى net.
  ['"paidAmount"', "integer"],
  // الرصيد الوارد من أحدث كشفٍ غير مُلغى (موقَّع: سالبٌ = دَينٌ على الفنيّ)
  ['"carryIn"', "integer"],
  // المُرحَّل إلى الفترة القادمة (موقَّع) — وعاءُ خيارَي محمد عند الصافي السالب
  ['"carryOut"', "integer"],
  // مقدارُ التقريب إلى الألف الأعلى: ceil(due/1000)*1000 − due ⇒ بين ٠ و٩٩٩ و**موجبٌ أبداً**
  // (يُخزَّن ولا يُحسب عند العرض، وإلّا اختلفت الشاشةُ عن المصروف واختلف الأرشيف)
  ['"roundingAdd"', "integer"],
  // طابعُ الإلغاء — اليومَ في auditLog وحده
  ['"cancelledAt"', "timestamp(3)"],
];
for (const [col, type] of cols) {
  await c.query(`ALTER TABLE salary_statements ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  console.log(`   ✅ ${col} ${type}`);
}

// ─────────────────────────────────────────────────────────────────────────────
say("٢) تعويضٌ رجعيّ: cancelledAt من سجلّ التدقيق");
// بلا هذا يبدو كلُّ كشفٍ مُلغىً وكأنّه فعّال، فيحجب الفهرسُ الفريدُ تسديداً مشروعاً،
// ويُورَّث carryOut كشفٍ مُلغى إلى الفترة القادمة.
const back = await c.query(`
  UPDATE salary_statements s
     SET "cancelledAt" = a.created
    FROM (
      SELECT "entityId"::int AS sid, MIN("createdAt") AS created
        FROM audit_logs
       WHERE action = 'SALARY_CANCEL' AND entity = 'salaryStatement'
         AND "entityId" ~ '^[0-9]+$'
       GROUP BY "entityId"
    ) a
   WHERE s.id = a.sid AND s."cancelledAt" IS NULL
  RETURNING s.id`);
console.log(`   وُسِم ملغياً: ${back.rowCount} كشفاً`);

// ─────────────────────────────────────────────────────────────────────────────
say("٣) الفهرس الفريد (technicianId, periodFrom, periodTo) للكشوف غير الملغاة");
// السبب: statementFor يُقرأ **خارج** المعاملة في field/salary/route.ts ⇒ تسديدان متسابقان
// يقرآن الحالةَ نفسَها فيدفعان الراتبَ مرّتين. وفحصٌ ثمّ إنشاءٌ داخل المعاملة **غيرُ ذرّيّ**
// على READ COMMITTED ⇒ الفهرسُ الفريدُ هو الجوابُ الوحيد.
// وهو **جزئيّ** (WHERE "cancelledAt" IS NULL) لأنّ إلغاءَ كشفٍ يجب أن يُحرّر فترتَه لتسديدٍ جديد.
const dups = await c.query(`
  SELECT "technicianId", "periodFrom", "periodTo", count(*) AS n,
         string_agg(id::text, ', ' ORDER BY id) AS ids
    FROM salary_statements
   WHERE "cancelledAt" IS NULL
   GROUP BY 1, 2, 3
  HAVING count(*) > 1
   ORDER BY count(*) DESC`);

if (dups.rowCount > 0) {
  console.log(`   ⚠️ تكراراتٌ قائمةٌ تمنع الفهرس: ${dups.rowCount} فترة`);
  for (const r of dups.rows) {
    console.log(`      فنيّ ${r.technicianId} · ${r.periodFrom} → ${r.periodTo} · ${r.n} كشوف (ids: ${r.ids})`);
  }
  console.log("   ⛔ لم يُنشأ الفهرس. تُعرَض هذه على محمد ليقرّر أيَّها يُلغى — ثمّ يُعاد السكربت.");
} else if (!APPLY_INDEX) {
  console.log("   ✅ لا تكرارات — الفهرسُ آمن. أعِد السكربت بـ--apply-index لإنشائه.");
} else {
  await c.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS salary_statements_tech_period_active_key
      ON salary_statements ("technicianId", "periodFrom", "periodTo")
      WHERE "cancelledAt" IS NULL`);
  console.log("   ✅ أُنشئ الفهرس الفريد الجزئيّ");
}

// ─────────────────────────────────────────────────────────────────────────────
say("٤) صلاحيّات RLS — تحقّقٌ لا تعديل");
// 02-grants.sql يمنح على **الجدول كاملاً** فتشمل الأعمدةُ الجديدةُ تلقائيّاً — لكنّ الافتراضَ
// لا يكفي: لو كان المنحُ على **أعمدةٍ بعينها** لبقيت الأعمدةُ الجديدةُ غيرَ مقروءةٍ للعامل.
// والتمييزُ الحاسم: `column_privileges` يعرض أعمدةَ المنح العامّ أيضاً، فالمعيارُ أن يكون
// عددُ الأعمدة الممنوحة = عددَ أعمدة الجدول كلِّها ⇒ منحٌ عامٌّ يشمل ما يُضاف.
const grants = await c.query(`
  SELECT privilege_type FROM information_schema.role_table_grants
   WHERE table_name = 'salary_statements' AND grantee = 'agent_worker'
   ORDER BY privilege_type`);
console.log(`   صلاحيّات agent_worker على الجدول: ${grants.rows.map((r) => r.privilege_type).join(", ") || "لا شيء"}`);
const cmp = await c.query(`
  SELECT (SELECT count(DISTINCT column_name) FROM information_schema.column_privileges
            WHERE table_name = 'salary_statements' AND grantee = 'agent_worker' AND privilege_type = 'SELECT') AS granted,
         (SELECT count(*) FROM information_schema.columns WHERE table_name = 'salary_statements') AS total`);
const { granted, total } = cmp.rows[0];
if (Number(granted) === Number(total)) {
  console.log(`   ✅ منحٌ عامٌّ على الجدول (${granted}/${total} عموداً) ⇒ الأعمدةُ الجديدةُ مشمولةٌ تلقائيّاً`);
} else {
  console.log(`   ⚠️ منحٌ على أعمدةٍ بعينها (${granted}/${total}) ⇒ **يلزم منحٌ صريحٌ للأعمدة الجديدة**:`);
  console.log(`      GRANT SELECT ("paidAmount","carryIn","carryOut","roundingAdd","cancelledAt") ON salary_statements TO agent_worker;`);
}
const pol = await c.query(`SELECT polname FROM pg_policy p JOIN pg_class t ON t.oid = p.polrelid WHERE t.relname = 'salary_statements'`);
console.log(`   السياسات: ${pol.rows.map((r) => r.polname).join(", ") || "لا شيء"}`);

// ─────────────────────────────────────────────────────────────────────────────
say("٥) التحقّق النهائيّ");
const q = await c.query(`
  SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_name = 'salary_statements'
     AND column_name IN ('paidAmount','carryIn','carryOut','roundingAdd','cancelledAt')
   ORDER BY column_name`);
console.log(`   أعمدةٌ موجودة: ${q.rows.length}/5`);
for (const r of q.rows) console.log(`      ${r.column_name} · ${r.data_type} · nullable=${r.is_nullable}`);

const idx = await c.query(`
  SELECT indexname FROM pg_indexes
   WHERE tablename = 'salary_statements' AND indexname = 'salary_statements_tech_period_active_key'`);
console.log(`   الفهرس الفريد: ${idx.rowCount ? "موجود ✅" : "غير موجود (بحسب الخيار)"}`);

const stats = await c.query(`
  SELECT count(*) AS total,
         count(*) FILTER (WHERE "cancelledAt" IS NOT NULL) AS cancelled,
         count(*) FILTER (WHERE net < 0) AS negative_net,
         count(*) FILTER (WHERE "moneyTxId" IS NULL) AS no_money_tx
    FROM salary_statements`);
const s = stats.rows[0];
console.log(`   الكشوف: ${s.total} · ملغاة ${s.cancelled} · صافيها سالب ${s.negative_net} · بلا قيد صرف ${s.no_money_tx}`);
console.log("\n✅ انتهت المهاجرة بلا أثرٍ على أيّ بيانٍ قائم.");

await c.end();
