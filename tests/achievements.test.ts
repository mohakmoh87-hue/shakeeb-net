import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { weightOfKind, KIND_WEIGHTS, DEFAULT_WEIGHT } from "../src/lib/achievements";

// ===== نقاطُ الإنجاز لكلّ فئة (طلب محمد 2026-08-13) =====
// «يُعطي المديرُ نقاطاً لكلّ فئةٍ حسب ما يرغب، **ويمكن أن يكون صفراً**، لمتابعة إنجازات
//  الفنيّين.»
//
// ⚠️ ولماذا اختبارٌ لهذا بالذات: البندُ كلُّه يقوم على **تمييزٍ واحدٍ زلقٍ** — بين «فارغ»
// و«صفر». والصفرُ **زائفٌ في جافاسكربت**، فأيُّ سطرٍ يُكتب بنمط «القيمةُ أو البديل»
// (`w || fallback` · `w ?? fallback` بعد `Number(x) || null` · `if (w)`) يُحوِّل الصفرَ إلى
// الوزن الافتراضيّ ⇒ فيصير «صفّرتُ هذه الفئة» تعني «أعطيتُها وزنَها الافتراضيّ» — وهو
// انقلابٌ تامٌّ لقرار المدير، **بلا أيّ خطأٍ ظاهرٍ يُنبِّه**. فيُثبَّت المعنى باختبارٍ
// يفشل لحظةَ ما يُكتَب ذلك النمطُ في أيّ موضع.
//
// والدالّةُ الحقيقيّةُ `agentKindWeights` تقرأ القاعدةَ فلا تُختبَر بلا قاعدة؛ فالمُختبَرُ هنا
// **المنطقُ الخالص** الذي بُنيت عليه: الأوزانُ المبنيّة، وقاعدةُ «الوجودُ لا الصدق».

describe("نقاطُ الإنجاز · الأوزانُ المبنيّة", () => {
  it("الأوزانُ المعتمدةُ كما أملاها محمد", () => {
    assert.equal(weightOfKind("تنصيب"), 2);
    assert.equal(weightOfKind("سحب جديد"), 2);
    assert.equal(weightOfKind("تحويل"), 1.5);
    assert.equal(weightOfKind("اعادة"), 1.5);
    assert.equal(weightOfKind("صيانة"), 1);
    assert.equal(weightOfKind("توصيل"), 0.25);
  });

  it("فئةٌ جديدةٌ يضيفها الوكيل ⇒ نقطةٌ واحدة", () => {
    assert.equal(weightOfKind("جباية"), DEFAULT_WEIGHT);
    assert.equal(weightOfKind(""), DEFAULT_WEIGHT);
    assert.equal(weightOfKind(null), DEFAULT_WEIGHT);
  });

  it("المرادفاتُ تُنسَب لعائلتها لا تسقط إلى الافتراضيّ", () => {
    assert.equal(weightOfKind("إعادة"), 1.5); // بهمزة
    assert.equal(weightOfKind("maintenance"), 1);
    assert.equal(weightOfKind("تنصيب جديد"), 2);
    assert.equal(weightOfKind("توصيل كارت"), 0.25);
  });

  it("قائمةُ الأوزان المعروضةُ تحمل الفئاتِ الستَّ", () => {
    assert.equal(KIND_WEIGHTS.length, 6);
    assert.ok(KIND_WEIGHTS.every((w) => typeof w.weight === "number" && w.weight > 0));
  });
});

describe("نقاطُ الإنجاز · قاعدةُ «الوجودُ لا الصدق»", () => {
  // مُحاكاةُ المُحلِّل الفعليّ في `computeAchievements`:
  //   custom.has(k) ? custom.get(k) : weightOfKind(k)
  const resolve = (custom: Map<string, number>, kind: string) =>
    custom.has(kind) ? (custom.get(kind) as number) : weightOfKind(kind);

  it("🔴 صفرٌ يعني **صفراً** لا الوزنَ الافتراضيّ", () => {
    const custom = new Map<string, number>([["توصيل", 0]]);
    assert.equal(resolve(custom, "توصيل"), 0, "التوصيلُ المُصفَّرُ يجب ألّا يُحتسَب إطلاقاً");
    // وهذه هي الكتابةُ الخاطئةُ التي يحرس منها الاختبار:
    const wrong = custom.get("توصيل") || weightOfKind("توصيل");
    assert.equal(wrong, 0.25, "توثيقُ الفخّ: النمطُ الزائفُ يُرجع ٠٫٢٥ بدل ٠");
    assert.notEqual(resolve(custom, "توصيل"), wrong, "فلا يجوز أن يُكتَب المُحلِّلُ بذلك النمط");
  });

  it("فارغٌ (غيرُ مضبوط) ⇒ الوزنُ المبنيُّ كما هو — فلا يتغيّر شيءٌ على وكيلٍ لم يُعدِّل", () => {
    const custom = new Map<string, number>(); // لم يضبط شيئاً
    assert.equal(resolve(custom, "تنصيب"), 2);
    assert.equal(resolve(custom, "صيانة"), 1);
    assert.equal(resolve(custom, "توصيل"), 0.25);
  });

  it("ما ضبطه المديرُ يعلو على المبنيّ — رفعاً وخفضاً", () => {
    const custom = new Map<string, number>([["صيانة", 5], ["تنصيب", 0.5]]);
    assert.equal(resolve(custom, "صيانة"), 5);
    assert.equal(resolve(custom, "تنصيب"), 0.5);
    assert.equal(resolve(custom, "تحويل"), 1.5, "وما لم يضبطه يبقى مبنيّاً");
  });

  it("الكسورُ تُحفَظ بلا تقريب (٠٫٢٥ لا تصير صفراً ولا واحداً)", () => {
    const custom = new Map<string, number>([["جباية", 0.25]]);
    assert.equal(resolve(custom, "جباية"), 0.25);
  });

  it("مجموعُ نقاطِ فنيٍّ = Σ وزنِ فئةِ كلّ بطاقة — والمُصفَّرةُ لا تُضيف", () => {
    const custom = new Map<string, number>([["توصيل", 0]]);
    const cards = ["تنصيب", "صيانة", "توصيل", "توصيل", "توصيل", "تحويل"];
    const points = cards.reduce((s, k) => s + resolve(custom, k), 0);
    assert.equal(points, 2 + 1 + 0 + 0 + 0 + 1.5);
    // وبلا تصفيرٍ كان المجموعُ أكبرَ بثلاثة أرباع النقطة
    const before = cards.reduce((s, k) => s + weightOfKind(k), 0);
    assert.equal(before, 2 + 1 + 0.75 + 1.5);
  });
});
