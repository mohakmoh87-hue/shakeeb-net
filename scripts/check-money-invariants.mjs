// ===== الطبقة ٤: حرّاسُ الحقائق الماليّة على بيانات الإنتاج (قراءةٌ فقط) =====
//
//   DATABASE_URL="postgres://…" node scripts/check-money-invariants.mjs
//   npm run check:money
//
// **لماذا هذه الطبقةُ أهمُّ من الاختبارات:** الاختباراتُ تحرس الشِفرةَ، وهذه تحرس **البيانات**.
// فالانحرافُ في نظامِ مالٍ لا يظهر بخطأٍ بل بصمتٍ — كحادثة الـ٨٧٠ ألفاً التي انكشفت بعد يومَين
// بالمصادفة. وهذا السكربتُ يُحوّلها إلى **إنذارٍ في صباح اليوم التالي**.
//
// لا يُعدّل شيئاً أبداً. يُرجع رمزَ خروجٍ ١ عند أيّ خللٍ ⇒ يصلح كرونَ GitHub يُرسل بريداً.
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

// ═════════════════ عزلُ الوكيل — شرطٌ لا يُتنازل عنه ═════════════════
// تصحيحُ محمد 2026-08-12: «المكتبُ ليس تابعاً لي، فأنا وكيل شكيب وصفاءُ مسؤولٌ عن ماله».
// وكان السكربتُ يعمل بحساب المشرف فيعرض مالَ **كلّ** الوكلاء ⇒ يُنذر محمداً بما لا يملكه ولا
// يحقّ له إصلاحُه، ويُسرّب حالَ وكيلٍ إلى آخر. وذلك يخالف العزلَ الذي يفرضه البرنامجُ نفسه.
//
//   node scripts/check-money-invariants.mjs --agent=1     ← تفاصيلُ وكيلٍ واحدٍ فقط
//   node scripts/check-money-invariants.mjs               ← ملخّصٌ بالأعداد بلا تفاصيل
//
// وبلا `--agent` لا تُطبع أيُّ تفصيلةٍ تخصّ وكيلاً بعينه — أعدادٌ فقط، ليعرف مالكُ النظام
// أنّ هناك خللاً عند وكيلٍ فيُبلّغه هو، لا أن يقرأ دفاتره.
const agentArg = process.argv.find((a) => a.startsWith("--agent="));
const AGENT = agentArg ? Number(agentArg.split("=")[1]) : null;
if (agentArg && !Number.isInteger(AGENT)) { console.error("--agent يحتاج رقماً"); process.exit(1); }
const DETAILS = AGENT != null; // التفاصيلُ لا تُعرض إلّا لوكيلٍ محدَّد

/** شرطُ عزلٍ على عمودِ مكتب */
const byTower = (col) => (AGENT == null ? "TRUE" : `${col} IN (SELECT id FROM towers WHERE "agentId" = ${AGENT})`);
/** شرطُ عزلٍ على عمودِ وكيلٍ مباشر */
const byAgent = (col) => (AGENT == null ? "TRUE" : `${col} = ${AGENT}`);

let failures = 0;
const results = [];

/** يُسجّل حقيقةً: `rows` فارغةٌ = سليم. وإلّا فخللٌ يُعرض بصفوفه. */
async function invariant(name, why, sql, params = []) {
  try {
    const r = await c.query(sql, params);
    const bad = r.rows.length;
    if (bad === 0) {
      results.push({ ok: true, name });
      console.log(`  ✅ ${name}`);
    } else {
      failures++;
      results.push({ ok: false, name, why, rows: DETAILS ? r.rows : undefined });
      console.log(`  ❌ ${name} — ${bad} خللاً`);
      console.log(`     السبب: ${why}`);
      if (!DETAILS) {
        console.log("     🔒 التفاصيلُ محجوبةٌ — أعِد بـ`--agent=<رقم الوكيل>` لترى دفترَ وكيلٍ واحد");
      } else {
        for (const row of r.rows.slice(0, 8)) console.log(`     · ${JSON.stringify(row)}`);
        if (bad > 8) console.log(`     · … و${bad - 8} غيرها`);
      }
    }
  } catch (e) {
    failures++;
    console.log(`  ⚠️ ${name} — تعذّر الفحص: ${e.message}`);
    results.push({ ok: false, name, why: "تعذّر الفحص: " + e.message });
  }
}

console.log("\n════════ حرّاسُ الحقائق الماليّة ════════\n");

// ─────────────────────────────────────────────────────────────────────────────
// (١) لا مبلغَ سالباً ولا كسريّاً في الصندوق.
// جذرُ العلّة الذي وجده التدقيق: `/api/money` يُصادِق `positive()` **بلا `.int()`** وعمودا
// moneyIn/moneyOut نوعُهما Float ⇒ سلفةٌ بكسرٍ تصل الصافيَ فتُسقط **تسديدَ الراتب كلَّه**
// (SalaryStatement.net عمودُ Int فترفضه القاعدة وتُلَفّ المعاملة).
await invariant(
  "لا مبلغَ سالباً ولا كسريّاً في money_tx",
  "الكسرُ يُسقط تسديدَ الراتب، والسالبُ يعني اتجاهاً مكتوباً في الحقل الخطأ",
  `SELECT id, "towerId", "sourceType", "moneyIn", "moneyOut", date
     FROM money_tx
    WHERE "isDeleted" = false AND ${byTower('"towerId"')}
      AND ( coalesce("moneyIn",0)  < 0 OR coalesce("moneyOut",0)  < 0
         OR coalesce("moneyIn",0)  <> floor(coalesce("moneyIn",0))
         OR coalesce("moneyOut",0) <> floor(coalesce("moneyOut",0)) )
    ORDER BY date DESC LIMIT 50`,
);

// (٢) كلُّ كشفِ راتبٍ: مجموعُ خاناته السبع = الصافي بالضبط.
// لو انفرط هذا لاختلف مجموعُ ما يراه المديرُ عن خليّة الصافي في الشاشة نفسها.
// ⚠️ الجدولُ **لا يحفظ** credits/advances عمودَين — تُشتقّان من بنود `details`. والمُتساوية
// الصحيحة: net = (الخانات الخمس المخزَّنة) + مجموعُ بنود credit/advance (وهي مخزَّنةٌ بإشارتها).
// و`details` بصيغتَين: مصفوفةٌ (قديم) أو كائنُ لقطةٍ v2 يحمل `items` ⇒ نقرأ الاثنَين.
// **وما لا يُقرأ لا يُتَّهم**: يُحصى في «تعذّر التحقّق» لا في الخلل — فحارسٌ يُنذر زوراً يُدرّب
// صاحبَه على تجاهل إنذاره.
const stRows = await c.query(`
  SELECT id, "technicianName", "periodFrom", "periodTo", net, details,
         ("baseEarned" + overtime + bonuses - "attendanceDeductions" - "confirmedDeductions") AS parts
    FROM salary_statements WHERE ${byAgent('"agentId"')} ORDER BY id DESC`);
const stBad = [];
let stUnverifiable = 0;
for (const r of stRows.rows) {
  let items = null;
  try {
    const d = JSON.parse(r.details ?? "null");
    items = Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : null;
  } catch { /* غيرُ صالحٍ كـJSON */ }
  if (!items) { stUnverifiable++; continue; }
  const moneyItems = items
    .filter((it) => it && (it.type === "credit" || it.type === "advance"))
    .reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const expected = Number(r.parts) + moneyItems;
  if (Number(r.net) !== expected) {
    stBad.push({ id: r.id, tech: r.technicianName, net: Number(r.net), expected, diff: Number(r.net) - expected });
  }
}
if (stBad.length === 0) {
  results.push({ ok: true, name: "مجموعُ خانات كلّ كشفٍ = net" });
  console.log(`  ✅ مجموعُ خانات كلّ كشفٍ = net (تعذّر التحقّق في ${stUnverifiable} — بنودُها غيرُ مقروءة)`);
} else {
  failures++;
  results.push({ ok: false, name: "مجموعُ خانات كلّ كشفٍ = net", rows: stBad });
  console.log(`  ❌ مجموعُ خانات كلّ كشفٍ = net — ${stBad.length} خللاً (وتعذّر التحقّق في ${stUnverifiable})`);
  console.log("     السبب: انفراطُ الكشف — المديرُ يجمع الخانات فلا تُطابق الصافي");
  for (const b of stBad.slice(0, 8)) console.log(`     · ${JSON.stringify(b)}`);
}
// وتكتمل بعد ب-٠٠ بمُتساوية: paidAmount + carryOut = net + carryIn + roundingAdd

// (٣) وصلُ تفعيلٍ بمالٍ يجب أن يقابله قيدٌ في الصندوق — وهذه عائلةُ حادثة الـ٨٧٠ ألفاً.
await invariant(
  "كلُّ وصل تفعيلٍ قابضٍ له قيدٌ في الصندوق",
  "وصلٌ يزعم قبضاً لا يقابله مالٌ (أو حُذف القيدُ وبقي الوصل) ⇒ فرقٌ في المبلغ الكلّي",
  `SELECT e.id AS entry_id, e."towerId", e."moneyIn", e.date
     FROM subscription_entries e
    WHERE e."isDeleted" = false AND ${byTower('e."towerId"')} AND coalesce(e."moneyIn",0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM money_tx m
         WHERE m."isDeleted" = false AND m."sourceId" = e.id
           AND m."sourceType" IN ('activation','master')
      )
    ORDER BY e.id DESC LIMIT 50`,
);

// (٤) والعكس: قيدُ تفعيلٍ في الصندوق ووصلُه محذوفٌ أو غائب ⇒ مالٌ بلا ورقة.
await invariant(
  "كلُّ قيدِ تفعيلٍ له وصلٌ قائم",
  "مالٌ في الصندوق بلا وصلٍ يفسّره — وهو الوجهُ المقابل لعلّة «الحذف بلا أثر ماليّ»",
  `SELECT m.id AS tx_id, m."towerId", m."moneyIn", m."sourceId", m.date
     FROM money_tx m
    WHERE m."isDeleted" = false AND ${byTower('m."towerId"')} AND m."sourceType" = 'activation' AND m."sourceId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM subscription_entries e
         WHERE e.id = m."sourceId" AND e."isDeleted" = false
      )
    ORDER BY m.date DESC LIMIT 50`,
);

// (٥) لا كشفَي راتبٍ فعّالَين لنفس الفنيّ ونفس الفترة (تسديدٌ مزدوج).
// السببُ المعروف: statementFor يُقرأ **خارج** المعاملة ⇒ نافذةُ سباق.
await invariant(
  "لا تسديدَ راتبٍ مزدوجاً لنفس الفترة",
  "راتبٌ دُفع مرّتين — والنافذةُ قائمةٌ حتى يُضاف الفهرسُ الفريد",
  `WITH cancelled AS (
      SELECT DISTINCT "entityId"::int AS sid FROM audit_logs
       WHERE action = 'SALARY_CANCEL' AND entity = 'salaryStatement' AND "entityId" ~ '^[0-9]+$'
   )
   SELECT "technicianId", "technicianName", "periodFrom", "periodTo", count(*) AS n,
          string_agg(id::text, ',' ORDER BY id) AS ids
     FROM salary_statements s
    WHERE s.id NOT IN (SELECT sid FROM cancelled) AND ${byAgent('s."agentId"')}
    GROUP BY 1,2,3,4 HAVING count(*) > 1 LIMIT 50`,
);

// (٦) كلُّ قيدٍ ماليٍّ منسوبٌ لمكتب (وإلّا سقط من كلّ تقريرٍ مُرشَّحٍ بالمكتب صامتاً).
await invariant(
  "كلُّ قيدٍ ماليٍّ له مكتب",
  "قيدٌ بلا مكتبٍ يسقط من التقارير المُرشَّحة ويبقى في المجاميع ⇒ سطورٌ لا تصالح مجموعَها",
  `SELECT id, "sourceType", "moneyIn", "moneyOut", date
     FROM money_tx WHERE "isDeleted" = false AND "towerId" IS NULL
    ORDER BY date DESC LIMIT 50`,
);

// (٧) عزلُ الوكلاء: لا مكتبَ بلا وكيل (وإلّا صار صفّاً بلا مالكٍ في كلّ سياسةٍ تعتمد agentId).
await invariant(
  "كلُّ مكتبٍ منسوبٌ لوكيل",
  "مكتبٌ بلا وكيل ⇒ صفوفُه خارجَ كلّ سياسةِ عزلٍ تعتمد agentId",
  `SELECT id, name FROM towers WHERE "isDeleted" = false AND "agentId" IS NULL LIMIT 50`,
);

// ─────────────────────────────────────────────────────────────────────────────
// أرقامٌ للإحاطة (لا حُكم) — تُعطي محمد صورةَ الحال في سطر
console.log("\n──────── أرقامُ إحاطة ────────");
const info = await c.query(`
  SELECT (SELECT count(*) FROM money_tx WHERE "isDeleted" = false)          AS money_rows,
         (SELECT count(*) FROM money_tx WHERE "isDeleted" = true)           AS money_deleted,
         (SELECT count(*) FROM salary_statements)                           AS statements,
         (SELECT count(*) FROM salary_statements WHERE net < 0)             AS statements_negative,
         (SELECT count(*) FROM salary_statements WHERE net % 1000 <> 0)     AS statements_unroundable,
         (SELECT count(*) FROM subscribers WHERE "isDeleted" = false AND coalesce(carry,0) < 0) AS credit_subscribers,
         (SELECT coalesce(sum(carry),0) FROM subscribers WHERE "isDeleted" = false AND coalesce(carry,0) < 0) AS credit_total,
         (SELECT count(*) FROM subscribers WHERE "isDeleted" = false AND coalesce(carry,0) > 0) AS debtors`);
const i = info.rows[0];
console.log(`  قيودُ الصندوق: ${i.money_rows} (محذوفةٌ ناعماً ${i.money_deleted})`);
console.log(`  كشوفُ الرواتب: ${i.statements} · صافيها سالب ${i.statements_negative} · غيرُ مضاعَفٍ للألف ${i.statements_unroundable}`);
console.log(`  مشتركون لهم رصيدٌ (carry سالب): ${i.credit_subscribers} بمجموع ${i.credit_total} — ⚠️ لا شاشةَ تُظهرهم اليوم (بند ب-٠٠)`);
console.log(`  مدينون: ${i.debtors}`);

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 ز-٢ · جدولٌ فيه عمودُ عزلٍ وبلا سياسةِ RLS — **شأنُ المالك لا شأنُ الوكيل**
//   فبنيةُ القاعدة لا تُعرَض في لوحةِ وكيلٍ مستأجر: هي ضجيجٌ له وكشفُ داخليّاتٍ في آنٍ.
//   وقاعدةُ المستودع: **كلُّ كتابةٍ جديدة = GRANT + سياسة** — وهذه الحقيقةُ تحرسها.
// 🎯 واصطاد من أوّل تشغيلٍ ثلاثةَ جداول: map_point_proposals · card_completions · managers.
//   والموقعُ يقرؤها بدورِ المالك فلا تسريبَ اليوم، لكنّ **حاسبةَ المكتب** تعمل بدورٍ محدودٍ
//   يعتمد على RLS وحدَه ⇒ أوّلُ كتابةٍ من العامل على أحدها تصير تسريباً بين الوكلاء.
{
  const r = await c.query(`
    SELECT c.relname AS tbl,
           (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname)::int AS pol
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false
       AND EXISTS (SELECT 1 FROM information_schema.columns k
                    WHERE k.table_name = c.relname AND k.column_name IN ('agentId','towerId'))
     ORDER BY 1`);
  const ok = r.rows.length === 0;
  results.push({ ok, name: "كلُّ جدولٍ فيه عمودُ عزلٍ له سياسةُ RLS" });
  if (!ok) failures++;
  console.log(`\n${ok ? "✅" : "⚠️"} كلُّ جدولٍ فيه عمودُ عزلٍ له سياسةُ RLS`);
  for (const x of r.rows) {
    console.log(`   • ${x.tbl} — RLS مُطفأ · سياساتُه ${x.pol}`);
  }
  if (!ok) console.log(`   العلاج: ENABLE ROW LEVEL SECURITY + سياسةُ agentId كما في prisma/rls/03-policies.sql`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n════════ الخلاصة ════════");
console.log(`  حقائقُ سليمة: ${results.filter((r) => r.ok).length} · مُخِلّة: ${failures}`);
if (failures === 0) console.log("  ✅ لا خللَ ماليّاً في البيانات");
else console.log("  ❌ خللٌ يحتاج نظرَ محمد (التفاصيلُ أعلاه)");

// ─────────────────────────────────────────────────────────────────────────────
// ⏳ حقائقُ تبقى لإكمالِ بنائها (تحتاج منطقَ المسارات لا السكيمةَ وحدها):
//   • «المبلغ الكلّي الموجود» محسوباً بطريقتَين مستقلّتَين ⇒ يجب أن يتساويا
//     (cumulativeDaily − cardPayments − managerExpenses − salaryFromTotal + managerReceipts)
//   • `subscriber.carry` = مجموعُ مصادره (تفعيلات + فواتير − تسديدات) ⇒ يكشف «الدين عُدِّل من خارج المصادر»
//   • ديونُ الكارتات = مجموعُ أسعار كروت الوكيل − المسدَّد + الإضافات − الإنقاصات
//   • رصيدُ الماستر = قبضُ الماستر − صرفُه
//   • **مسبارُ عزلٍ حقيقيّ**: الدخولُ بدور `agent_<id>_worker` وإثباتُ أنّه يرى صفوفَه وحدها
//     (يحتاج كلماتِ الأدوار من scratchpad/railway-agent-roles.txt)
//   • بعد ب-٠٠: paidAmount + carryOut = net + carryIn + roundingAdd لكلّ كشف

await c.end();
process.exit(failures > 0 ? 1 : 0);
