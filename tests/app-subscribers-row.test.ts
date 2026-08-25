import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 📱 صفُّ المشترك في التطبيق — بلاغُ محمد 2026-08-25 ═════
//
// بنصّه: «في تطبيق الهاتف، في صفحة آخر التفعيلات، لا يوجد مربّعُ تحديد مشتركٍ في بداية
// سطر كلّ مشترك. وعند ضغط الثلاث نقاط تظهر خياراتٌ ومنها حالةُ الاتصال — يجب أن يكون
// أسفلها رقمُ هاتف هذا المشترك».
//
// 🔑 وكلاهما **إخفاءٌ متعمَّدٌ سابقٌ لا عطل**: طرازُ التطبيق ضيّق الجدولَ إلى ثلاث خانات،
//   فأخفى خانةَ التحديد **وخاناتِ الخامسة فصاعداً وفيها رقمُ الهاتف** — فالرقمُ لم يكن
//   يظهر في التطبيق إطلاقاً، لا في الجدول ولا في المنبثقة.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const CSS = () => read("src/app/globals.css");
const BOARD = () => read("src/components/SubscribersBoard.tsx");

describe("📱 مربّعُ التحديد في التطبيق", () => {
  test("🔲 خانةُ التحديد لم تعد مخفيّةً في طراز التطبيق", () => {
    const css = CSS();
    // القاعدةُ التي كانت تُخفيها — يجب ألّا يعود أيٌّ من شقَّيها
    assert.equal(/html\[data-app-trial\] \.tbl\.subs td\.cbcol,/.test(css), false,
      "عاد إخفاءُ خانة التحديد في التطبيق — ولا سبيلَ لحصر الحذف بعدها");
    assert.equal(/html\[data-app-trial\] \.tbl\.subs th:first-child,/.test(css), false,
      "عاد إخفاءُ رأس خانة التحديد (تحديد الكلّ) في التطبيق");
    // وخانتُها مضبوطةُ العرض كي لا يعود التمريرُ الجانبيُّ الذي أُلغي
    assert.match(css, /html\[data-app-trial\] \.tbl\.subs \.cbcol \{ width: 26px;/,
      "خانةُ التحديد بلا عرضٍ مخصَّصٍ في التطبيق — تزاحم الاسمَ أو تُعيد التمرير الجانبيّ");
    // 🔒 وبقيّةُ التضييق كما هي: الخاناتُ من الخامسة فصاعداً تبقى مخفيّةً في التطبيق
    assert.match(css, /html\[data-app-trial\] \.tbl\.subs th:nth-child\(n\+5\)/,
      "تضييقُ الجدول في التطبيق سقط — يعود التمريرُ الجانبيّ");
  });

  test("🔒 والمربّعُ يخدم الحذفَ الجماعيَّ نفسَه — لا مسارَ جديد", () => {
    const b = BOARD();
    assert.match(b, /<td className="cbcol" onClick=\{\(e\) => e\.stopPropagation\(\)\}>/,
      "خانةُ التحديد لا تمنع فتحَ الصفّ عند لمسها");
    assert.match(b, /checked\.has\(s\.id\)\} onChange=\{\(\) => toggleCheck\(s\.id\)\}/, "مربّعُ الصفّ تغيّر");
    // وهذا هو سببُ أهميّته: بلا تحديدٍ يحذف الزرُّ **كلَّ المعروضين**
    assert.match(b, /const ids = checked\.size > 0 \? \[\.\.\.checked\] : subs\.map\(\(s\) => s\.id\);/,
      "قاعدةُ «المحدَّدون وإلّا كلُّ المعروضين» تغيّرت — أعد تقييمَ أثر المربّع");
  });
});

describe("☎️ رقمُ الهاتف في منبثقة المشترك", () => {
  test("الرقمُ يظهر تحت «حالة الاتصال» مباشرةً", () => {
    const b = BOARD();
    const at = b.indexOf('sasStatus.state === "loading" ? "… جارٍ الفحص"');
    assert.ok(at > -1, "شارةُ حالة الاتصال لم يُعثر عليها");
    const after = b.slice(at, at + 900);
    assert.match(after, /className="sb-chip trial-only-chip" title="رقم هاتف المشترك">الهاتف <b dir="ltr">\{s\.phone \?\? "—"\}<\/b>/,
      "شارةُ الهاتف ليست بعد حالة الاتصال — أو فقدت اتّجاهَ الأرقام (dir=ltr)");
  });

  test("📐 وصفّاً كاملاً — وإلّا وقع تحت «اليوزر» لا تحت «حالة الاتصال»", () => {
    // قِيس بلقطةٍ من هاتف محمد (2026-08-25): الشاراتُ شبكةٌ بعمودَين و«متصل» في العمود
    // الأيسر ⇒ شارةٌ عاديّةٌ بعدها تقع في **يمين** الصفّ التالي. والعرضُ الكاملُ يضعها
    // تحتها مباشرةً — نفسُ حيلة شارة «العنوان» القائمة.
    const css = CSS();
    assert.match(css, /html\[data-app-trial\] tr\.subrow \.sb-row \.sb-chip\[title\*="رقم هاتف"\] \{ grid-column: 1 \/ -1; \}/,
      "شارةُ الهاتف ليست بعرض الصفّ ⇒ تقع تحت «اليوزر» لا تحت «حالة الاتصال»");
    // والشبكةُ عمودان — لو تغيّرت لبطَل التعليلُ أعلاه
    assert.match(css, /html\[data-app-trial\] tr\.subrow \.sb-row \{ position: relative; display: grid; grid-template-columns: 1fr 1fr;/,
      "تخطيطُ المنبثقة تغيّر — أعد تقييمَ موضع شارة الهاتف");
  });

  test("🔒 وللتطبيق وحدَه — فخانتُه في المتصفّح ظاهرةٌ ولا تُكرَّر", () => {
    const b = BOARD();
    // نفسُ نمط شارة «اليوزر»: `trial-only-chip` مخفيّةٌ خارج التطبيق بقاعدةٍ صريحة
    assert.match(b, /title="رقم هاتف المشترك"/, "شارةُ الهاتف غائبة");
    assert.equal(/title="رقم هاتف المشترك"[^>]*className="sb-chip"/.test(b), false,
      "شارةُ الهاتف بلا وسم trial-only-chip ⇒ تظهر في المتصفّح مكرَّرةً مع خانة الجدول");
    const css = CSS();
    assert.match(css, /html:not\(\[data-app-trial\]\) \.trial-only-chip \{ display: none !important; \}/,
      "قفلُ «عناصر التطبيق» خارج التطبيق سقط — تظهر شارةُ الهاتف في المتصفّح");
    assert.match(css, /html\[data-app-trial\] tr\.subrow \.trial-only-chip \{ display: flex; \}/,
      "شاراتُ التطبيق لا تظهر داخل المنبثقة");
  });
});

// ═════ 📏 سطرُ المشترك يتّسع للشاشة — بلاغُ محمد 2026-08-25 ═════
// بنصّه: «في صفحة المشتركين، لماذا هذا الفراغُ الموجود في سطر المشترك بحيث يجب عليّ
// التمريرُ لرؤية البقيّة؟» ثمّ: «يجب أن يكون السطرُ **بدون إنزال سطر** من أجل يوزرٍ أو
// اسمٍ أو أيّ شيءٍ آخر، لكي لا يعرض السطرُ نفسه».
//
// 🔬 وقِيس حيّاً على عرض 375px بالـCSS المُصرَّف: **قبل ٣٨٠px في إطار ٣٥٦** ⇒ فيضٌ يُجبره
//   على التمرير. وإضافةُ مربّع التحديد كانت سترفعه إلى ٣٩٣. **وبعد الإصلاح ٣٥٦/٣٥٦.**
describe("📏 سطرُ المشترك في التطبيق — يتّسع بلا تمريرٍ ولا نزولِ سطر", () => {
  test("الجدولُ بعرض الشاشة لا بعرض محتواه", () => {
    assert.match(CSS(), /html\[data-app-trial\] \.tbl\.subs \{ table-layout: fixed; width: 100%; \}/,
      "عرضُ الجدول عاد مجموعَ محتوياته ⇒ يفيض السطرُ ويضطرّ للتمرير الأفقيّ");
  });

  test("🚫 ولا نزولَ سطر: القصُّ بنقاطٍ لا بالتفاف النصّ", () => {
    const css = CSS();
    // الأساسُ `white-space: nowrap` على كلّ خليّة — والحلُّ حذفٌ لا التفاف
    assert.match(css, /\.tbl tbody td \{[^}]*white-space: nowrap;/, "خلايا الجدول لم تعد سطراً واحداً ⇒ يعلو السطرُ ويتكسّر");
    assert.match(css, /td:nth-child\(2\) \{\s*\r?\n?\s*max-width: none; overflow: hidden; text-overflow: ellipsis;/,
      "خانةُ الاسم بلا حذفٍ بالنقاط ⇒ إمّا تفيض أو تُكسِّر السطر");
    assert.match(css, /width: 110px; padding-inline: 5px; font-size: 11px;\s*\r?\n?\s*overflow: hidden; text-overflow: ellipsis;/,
      "خانةُ اليوزر بلا حذفٍ بالنقاط ⇒ إمّا تفيض أو تُكسِّر السطر");
  });

  test("📐 والأعرضُ مقيسةٌ: عمليات ٨٠ واليوزر ١١٠ — والاسمُ يأخذ الباقي", () => {
    const css = CSS();
    // 🔬 ٨٠ لا ٧٤: القياسُ الحيُّ أظهر أنّ ٧٤ تقصّ زرَّ ⋯ خمسةَ بكسلات
    assert.match(css, /tbody tr:not\(\.subrow\) td:nth-child\(3\) \{ width: 80px;/, "عرضُ «عمليات» تغيّر — أعِد قياسَه فقد يُقَصّ زرُّ ⋯");
    // 🔑 واليوزر لا يُنقَص لأجل الاسم: هو الفيصلُ الذي لا يُخطئ، وقصُّه أضرُّ
    assert.match(css, /tbody tr:not\(\.subrow\) td:nth-child\(4\) \{\s*\r?\n?\s*width: 110px;/, "عرضُ «اليوزر» تغيّر — قد يُقَصّ اليوزر");
    // والاسمُ حُرِّر من عرضه المفروض (`max-width: 170px`) ليأخذ ما بقي
    assert.match(css, /html\[data-app-trial\] \.tbl\.subs tbody tr:not\(\.subrow\) td:nth-child\(2\) \{\s*\r?\n?\s*max-width: none;/,
      "عادَ العرضُ المفروضُ على خانة الاسم ⇒ يفيض الجدول");
  });
});
