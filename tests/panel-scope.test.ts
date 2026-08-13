import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ أ-٢٣ · نطاقُ لوحة الساس لا يُرَشُّ على جدولٍ لا يملكه ═════
// بلاغُ صميم 2026-08-13: المزامنةُ تسقط بـ
//   «Invalid `prisma.loanDebt.findMany()` … Unknown argument `sasPanelId`»
// على مكتبٍ بلوحتَين — فتضيع **المرحلةُ الثانيةُ كلُّها** (تصحيحُ التواريخ والاستيراد).
//
// والسببُ نمطيٌّ لا عارض: عند بناء «مكتبٌ بلوحتَي ساس» أُنشئ نطاقٌ عامٌّ
// (`panelWhere = { sasPanelId }`) ونُشر على استعلاماتِ المزامنة — وثلاثةٌ منها على
// `Subscriber` (وهو **الجدولُ الوحيد** الذي يحمل العمود) والرابعُ على `LoanDebt`.
// و**بريزما لا تكتشفه إلّا وقتَ التشغيل**، فمرّ من `tsc` ومن كلّ اختبار.
//
// ⇒ فهذا الاختبارُ يُغني عن الذاكرة: يقرأ السكيمةَ فيعرف مَن يملك العمودَ فعلاً، ثمّ
//   يمسح المستودعَ فيُسقط أيَّ استعلامٍ يذكره على غيره. ويكتشف الصنفَ كلَّه لا الحالةَ.

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, "prisma", "schema.prisma");
/** العمودُ محلُّ الحادثة — ويُزاد على القائمة كلُّ عمودٍ «نطاقيٍّ» يُرَشُّ على استعلامات. */
const SCOPED_FIELDS = ["sasPanelId", "odooPanelId"];

/** أسماءُ النماذج التي تُعلن عموداً بعينه في `schema.prisma`. */
function modelsDeclaring(field: string): Set<string> {
  const src = fs.readFileSync(SCHEMA, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    // إعلانُ عمودٍ يبدأ السطرَ باسمه — لا ذِكرُه في `@@index` أو في تعليق
    if (new RegExp(`^\\s{2}${field}\\s`, "m").test(m[2])) out.add(m[1]);
  }
  return out;
}

/** اسمُ النموذج كما تكتبه بريزما في الكود (`prisma.loanDebt` ⇒ `LoanDebt`). */
const toModel = (call: string): string => call.charAt(0).toUpperCase() + call.slice(1);

/** يُفرِغ التعليقاتَ من النصّ مع **حفظِ أطوالِه** (فتبقى أرقامُ السطور صحيحة).
 *  ولا بدّ منه: أخصبُ مصادرِ الإنذار الكاذب تعليقٌ يشرح **لماذا** لا يُستعمل العمود. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += " ".repeat(stop - i); i = stop;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " "); i = stop;
    } else {
      out += src[i]; i++;
    }
  }
  return out;
}

/** جسمُ وسيطِ النداء بمطابقةِ الأقواس — لا نافذةٌ بعددِ حروفٍ مُخمَّن.
 *  فالنافذةُ الثابتةُ تتعدّى إلى النداء التالي وإلى ما بعده فتُنذر كذباً. */
function argBody(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return src.slice(openParen, i + 1);
    }
  }
  return src.slice(openParen, Math.min(src.length, openParen + 2000));
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") sourceFiles(p, acc); }
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe("نطاقُ لوحة الساس: لا عمودَ نطاقٍ على جدولٍ لا يُعلنه", () => {
  test("السكيمةُ تُعلن `sasPanelId` على `Subscriber` (وهو مرجعُ الاختبار)", () => {
    const owners = modelsDeclaring("sasPanelId");
    assert.ok(owners.has("Subscriber"), "غاب العمودُ عن Subscriber — تغيّرت السكيمةُ فأعِد النظر");
    assert.ok(!owners.has("LoanDebt"),
      "صار `LoanDebt` يُعلن `sasPanelId`: إن كان بقصدٍ فأزِل استثناءَه من هذا الاختبار");
  });

  for (const field of SCOPED_FIELDS) {
    test(`لا استعلامَ بريزما يذكر \`${field}\` على نموذجٍ لا يُعلنه`, () => {
      const owners = modelsDeclaring(field);
      // `src` وحدَه: الاختباراتُ تتحدّث **عن** الاستعلامات ولا تُنفّذها
      const files = sourceFiles(path.join(ROOT, "src"));
      const bad: string[] = [];

      for (const f of files) {
        const raw = fs.readFileSync(f, "utf8");
        const src = stripComments(raw); // بلا هذا يُنذر أيُّ تعليقٍ يشرح البندَ كذباً
        // كلُّ نداءٍ `prisma.<model>.<op>(` أو `tx.<model>.<op>(` أو `t.<model>.<op>(`
        for (const m of src.matchAll(/\b(?:prisma|tx|t)\.([a-z][A-Za-z0-9]*)\.(findMany|findFirst|findUnique|count|update|updateMany|create|createMany|upsert|delete|deleteMany|aggregate|groupBy)\s*\(/g)) {
          const model = toModel(m[1]);
          const body = argBody(src, m.index + m[0].length - 1); // جسمُ الوسيط بمطابقةِ الأقواس
          // الذكرُ صريحاً، أو عبر النطاق العامّ الذي يحمل العمود
          const mentions = new RegExp(`\\b${field}\\b`).test(body)
            || (field === "sasPanelId" && /\.\.\.panelWhere\b/.test(body));
          if (!mentions) continue;
          if (owners.has(model)) continue;
          const line = src.slice(0, m.index).split("\n").length;
          bad.push(`${path.relative(ROOT, f)}:${line} — prisma.${m[1]}.${m[2]}() يذكر ${field} و${model} لا يُعلنه`);
        }
      }

      assert.deepEqual(bad, [],
        `استعلامٌ سيسقط وقتَ التشغيل بـ«Unknown argument \`${field}\`» (وهو ما أسقط مزامنةَ صميم):\n  ${bad.join("\n  ")}`);
    });
  }
});
