import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// ═════ 🔬 حالتا bg-17-19-6@amr وbg-16-23-11@amr (بلاغ محمد 2026-08-27) ═════
//
// «هذا المشترك يجب أن يزيد شهراً · وهذا يجب أن ينقص ٥ أيّام — وهذه المشاكل يجب أن
//  تُحلّ عن طريق المزامنة». ثلاثةُ حرّاسٍ متراكبةٍ كانت تُخفيهما معاً:
//   ١. «مغطًّى»/«مقبوضٌ عندي» في المرحلة الأولى يضيفان لـactedSasIds بلا صفٍّ معلَّق
//      ⇒ بوّابةُ فرقِ الأيّام في المرحلة الثانية مقفلةٌ عليهما للأبد.
//   ٢. قربُ الوصل من تاريخنا (`RECEIPT_NEAR_MS`) كان `classified = true` ⇒ النقصُ
//      المدفوعُ بوصلٍ لا يظهر أبداً — والوصلُ الشهريُّ يجدّد الإسكاتَ كلَّ شهر.
//   ٣. شرطُ «معلوم الباقة» في رأس البوّابة ⇒ نقصُ مجهولِ الباقة بلا رصدٍ إطلاقاً
//      (التمديدُ التلقائيُّ للأمام وحدَه فلا يمسّه).
// ومعها علّةُ الوسم: الاستيرادُ (بيتُ وسم اللوحة) لا يُعاد تشغيلُه لمستورَدين سلفاً
// («كلُّ المشتركين مستوردون فلا يمكن استيرادُ أحد» — ٤٤٦٥ بلا وسمٍ عند كاسبر)،
// فصار الوسمُ في المزامنة نفسِها: يوزر+رقم تطابقا في قائمة اللوحة وبلا وسمٍ ⇒ يُوسَم.

const ROOT = process.cwd();
const SYNC = () => fs.readFileSync(path.join(ROOT, "src/lib/subscriptionSync.ts"), "utf8");

describe("🔬 حالتا +شهر و−أيّام تُحلّان عن طريق المزامنة (2026-08-27)", () => {
  test("١ · «المعلَّقُ وحدَه يُسكِت» — مغطًّى ومقبوضٌ عندي لا يقفلان بوّابةَ فرق الأيّام", () => {
    const src = SYNC();
    // فرعُ «مغطًّى» يمضي بلا إضافةٍ إلى actedSasIds — يبقى الحدثُ ساقطاً والرسالةُ ساقطة
    assert.ok(src.includes("if (covered) { await resolveEventIfReceipted(officeId, a.sasUserId, actAt); continue; }"),
      "فرعُ «مغطًّى» تغيّر شكلُه — تأكّد أنّ الإسكات لم يعد");
    assert.ok(!src.includes("if (covered) { actedSasIds.add"), "عاد إسكاتُ «مغطًّى» — يضيع +الشهر المقبوض");
    // وفرعُ «مقبوضٌ عندي» كذلك: بين شرطِه ونداءِ الإغلاق لا إضافةَ إسكات
    const at = src.indexOf("if (await collectedByUs(subUserKey, sub.id, actAt, validNewExp)) {");
    assert.ok(at > -1, "فحصُ «مقبوضٌ عندي» ضاع من المرحلة الأولى");
    const branch = src.slice(at, src.indexOf("}", src.indexOf("continue;", at)) + 1);
    assert.ok(!branch.includes("actedSasIds.add"), "عاد إسكاتُ «مقبوضٌ عندي» — يضيع فرقُ الأيّام خلفه");
  });

  test("٢ · النقصُ المدفوعُ بوصلٍ يُرصَد موسوماً بالأحمر لا يُسكَت للأبد", () => {
    const src = SYNC();
    assert.ok(src.includes("<= RECEIPT_NEAR_MS)) receiptBacked = true;"), "قربُ الوصل لم يعد يُعلِم — فكيف يُوسَم؟");
    assert.ok(!src.includes("<= RECEIPT_NEAR_MS)) classified = true;"), "عاد الإسكاتُ الأبديُّ للنقص المدفوع بوصل");
    // الوسمُ في التسمية وفي راية الخطر (خارجَ «تحديد الكلّ» في الواجهة)
    assert.ok(src.includes("وتاريخُنا مدفوعٌ بوصل"), "الصفُّ لا يقول إنّ التاريخ مدفوعٌ بوصل — فيُطبَّق جهلاً");
    assert.ok(src.includes("...(lostDays > 7 || receiptBacked ? { danger: true } : {}),"), "المدفوعُ بوصلٍ بلا رايةِ خطر");
    // والمدفوعُ بوصلٍ لا يُسأل الساسُ عنه (وصلٌ عندي ⇒ ليس خارجيّاً — لا تصنيفَ حدثٍ له)
    assert.ok(src.includes("if (!classified && !receiptBacked) {"), "المدفوعُ بوصلٍ صار يُصنَّف حدثاً — ومحمد قال ليس خارجيّاً");
  });

  test("٣ · نقصُ مجهولِ الباقة يُرصَد — وزيادتُه تبقى للتمديد التلقائيّ وحدَه", () => {
    const src = SYNC();
    assert.ok(src.includes("&& (sasPkgIdForDiff != null || (p.dateTo && validDate < p.dateTo))) {"),
      "بوّابةُ فرق الأيّام أُغلقت على مجهول الباقة كلّيّاً — فنقصُه بلا رصد");
    // والتمديدُ التلقائيُّ لمجهول الباقة باقٍ للأمام فقط (لا تقصيرَ تلقائيّاً أبداً)
    assert.ok(src.includes("if (validDate && sasDateIsLater(p.dateTo, validDate)) {"), "التمديدُ التلقائيُّ لمجهول الباقة ضاع");
  });

  test("٥ · أودو: اللوحةُ الأولى وحدةُ سحبٍ حين تفرغ أعمدةُ المكتب — ولا ازدواجَ معها أبداً", () => {
    // (بلاغُ كاسبر 2026-08-27: حسابا اللوحتين مُدخلان في «لوحات الساس» وأعمدةُ المكتب فارغة —
    //  فكان شرطُ isPrimary: false في الاستعلام يُميت حسابَ الأولى فلا تسحب من أيّ مكان.)
    const src = fs.readFileSync(path.join(ROOT, "src/lib/odooSync.ts"), "utf8");
    assert.ok(!/isPrimary: false/.test(src), "عاد إقصاءُ الأولى في الاستعلام نفسِه — فيموت حسابُها المُدخَل في اللوحة");
    assert.ok(src.includes("if (!p.isPrimary) return true;"), "غيرُ الأولى لم تعد تُقبَل دائماً");
    assert.ok(src.includes("return !(t?.odooUser?.trim() && t?.odooPass?.trim());"),
      "الأولى تُقبَل حتى مع حسابٍ على أعمدة المكتب — ازدواجُ معالجةٍ (ب-١)");
  });

  test("٤ · الوسمُ بالمزامنة: يوزر+رقم تطابقا وبلا وسمٍ ⇒ يُوسَم للوحته دفعةً", () => {
    const src = SYNC();
    assert.ok(src.includes("if (oldByUser.sasPanelId == null && panelId != null) { stampIds.push(oldByUser.id); oldByUser.sasPanelId = panelId; }"),
      "المطابَقُ غيرُ الموسوم لا يُجمَع للوسم");
    assert.ok(src.includes("const stampIds: number[] = [];"), "قائمةُ الوسم غيرُ معلنة");
    const flushAt = src.indexOf("if (stampIds.length && panelId != null) {");
    assert.ok(flushAt > -1, "لا كتابةَ للوسم بعد الحلقة");
    const flush = src.slice(flushAt, flushAt + 400);
    // 🔒 عزلٌ: الكتابةُ بمعرّفاتٍ جُمعت من مشتركي المكتب حصراً، ولا تمسّ موسوماً (شرطُ null)
    assert.ok(flush.includes("sasPanelId: null"), "الكتابةُ قد تمسّ موسوماً سلفاً");
    assert.ok(flush.includes("data: { sasPanelId: panelId }"), "الكتابةُ لا تضع وسمَ اللوحة");
  });
});
