import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { movingAverage } from "../src/app/api/_lib/itemBatchLog";

// ═════ 📊 متوسّطُ الشراء المتحرّك — بلاغُ محمد 2026-08-25 (بعد تجربة الميزة) ═════
//
// بنصّه: «عند محاولة زيادة مادة أكتب السعرَ الجديد **فيتغيّر معه سعرُ الشراء لكلّ العدد
//  السابق**، ولكن يجب عند زيادة عددٍ وكتابة سعرِ العدد أن **يبقى القديمُ بسعرٍ والجديدُ
//  بالسعر الجديد**» ثمّ: «**وأن يظهر متوسّطُ السعر لي**».
//
// 🔴 والعلّة: خانةُ «سعر المادة (الكلفة)» في نموذج المدير كانت تُكتب فوق المخزون كلِّه.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PUT = () => read("src/app/api/items/[id]/route.ts");

describe("📊 المتوسّطُ المرجّح — حسابٌ لا نصّ", () => {
  test("حالةُ محمد بالأرقام: ١٠ بـ٥٠٠٠ ثمّ ١٠ بـ٧٠٠٠ ⇒ ٦٠٠٠ لا ٧٠٠٠", () => {
    assert.equal(movingAverage(10, 5000, 10, 7000), 6000);
    // 🔴 وهذا هو ما كان يحدث قبل الإصلاح — سعرُ الدفعة يبتلع الكلّ
    assert.notEqual(movingAverage(10, 5000, 10, 7000), 7000);
  });

  test("الترجيحُ بالكميّة لا بعدد الدفعات", () => {
    // ٩٠ بـ١٠٠٠ ثمّ ١٠ بـ٢٠٠٠ ⇒ ١١٠٠ (لا ١٥٠٠ الذي هو متوسّطُ السعرَين المجرَّد)
    assert.equal(movingAverage(90, 1000, 10, 2000), 1100);
    assert.notEqual(movingAverage(90, 1000, 10, 2000), 1500);
  });

  test("🔒 مخزونٌ صفرٌ أو كلفةٌ مجهولة ⇒ سعرُ الدفعة وحدَه — لا خلطَ مجهولٍ بمعلوم", () => {
    assert.equal(movingAverage(0, 5000, 10, 7000), 7000, "مخزونٌ صفرٌ لا كلفةَ له تُرجَّح");
    assert.equal(movingAverage(10, null, 10, 7000), 7000, "كلفةٌ مجهولةٌ رُجّحت كأنّها صفر");
    assert.equal(movingAverage(10, 0, 5, 3000), 3000, "كلفةُ صفرٍ عوملت رقماً معلوماً");
  });

  test("🛡️ ولا يُفسده مدخَلٌ فاسد", () => {
    assert.equal(movingAverage(10, 5000, 0, 7000), 5000, "زيادةُ صفرٍ غيّرت المتوسّط");
    assert.equal(movingAverage(-5, 5000, 10, 7000), 7000, "كميّةٌ سالبةٌ لم تُقصَّ");
    assert.ok(Number.isFinite(movingAverage(NaN as unknown as number, NaN as unknown as number, 10, 7000)));
  });
});

describe("🔗 والخادمُ يفرضه — لا الواجهةُ وحدَها", () => {
  test("الزيادةُ تحسب المتوسّطَ وتتجاوز أيَّ كلفةٍ كُتبت في النموذج", () => {
    const src = PUT();
    // مسارُ المستخدم العاديّ
    assert.match(src, /const avg = movingAverage\(current, existing\.priceDinar, q\.data\.count - current, q\.data\.batchBuyPrice \?\? 0\);/,
      "مسارُ المستخدم لا يحسب المتوسّط");
    assert.match(src, /data: \{ count: q\.data\.count, priceDinar: Math\.round\(avg\) \}/, "المتوسّطُ لا يُكتب");
    // مسارُ المدير — والتجاوزُ **بعد** التفكيك فيغلب ما كتبه في النموذج.
    // 🔄 وصار مشروطاً بوجود سعر دفعةٍ فعلاً (محمد 2026-08-25): «زرُّ تعديل يعود إلى ما
    //    كان عليه — يزيد أو ينقص عددَ مادة»، فتصحيحُ العدد بلا سعرٍ لا يُحرّك المتوسّط.
    assert.match(src, /if \(isIncrease && hasBatchPrice\) \{\s*\r?\n\s*itemData\.priceDinar = Math\.round\(/,
      "🔴 كلفةُ النموذج تغلب المتوسّطَ ⇒ يعود عطلُ «يتغيّر سعرُ الشراء لكلّ العدد السابق»");
    assert.match(src, /const isIncrease = parsed\.data\.count != null && parsed\.data\.count > before;/,
      "شرطُ الزيادة تغيّر — قد يُعاد حسابُ المتوسّط عند الإنقاص");
  });

  test("🔑 وسعرُ الدفعة يُحفظ في السجلّ كما هو — لا المتوسّطُ مكانَه", () => {
    const src = PUT();
    assert.match(src, /await logQty\(before, parsed\.data\.count, batchBuyPrice\);/,
      "السجلُّ يحفظ المتوسّطَ بدل سعر الدفعة ⇒ يضيع السعرُ الحقيقيُّ للدفعة");
    assert.equal(/logQty\([^)]*avg[^)]*\)/.test(src), false, "المتوسّطُ سُرّب إلى سجلّ الدفعات");
  });

  test("🔒 وسعرُ الدفعة حقلٌ مستقلٌّ عن الكلفة — لا يُشتقّ منها", () => {
    const src = PUT();
    assert.equal(/batchBuyPrice \?\? parsed\.data\.priceDinar/.test(src), false,
      "🔴 عاد اشتقاقُ سعر الدفعة من خانة الكلفة — وهو أصلُ بلاغ محمد");
    // 🔄 وحقلُ سعر الدفعة انتقل من نموذج «تعديل» إلى **نافذة الإضافة** (محمد 2026-08-25)
    assert.match(read("src/components/AddItemModal.tsx"), /سعر شراء الدفعة/,
      "نافذةُ الإضافة بلا حقلٍ لسعر الدفعة");
    const page = read("src/app/(app)/inventory/page.tsx");
    assert.match(page, /header: "متوسّط الشراء"/, "عمودُ متوسّط الشراء لا يظهر — وهو نصُّ طلبه");
  });
});
