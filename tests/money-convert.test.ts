import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ أ-٥ · الموضع ٣: تحويلُ وصلٍ قائمٍ بين الماستر والنقديّ ═══════
//
// طلبُ محمد (ذكّرني به 2026-08-14): «تحويلُ وصلِ مشتركٍ موجودٍ من ماستر إلى نقديّ
//  وبالعكس… لكن لم أرَ ذلك يُطبَّق» — وهو صحيح: البندُ كان موصوفاً ولم يُبنَ.
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const API = "src/app/api/money/[id]/convert/route.ts";

describe("أ-٥/٣ · تحويلُ الوصل بين الماستر والنقديّ", () => {
  test("🔑 المعنى يُقرَأ من `moneyKinds.ts` لا من قائمةٍ يدويّة", () => {
    const src = read(API);
    assert.ok(src.includes('from "@/lib/moneyKinds"'), "قائمةٌ يدويّةٌ لمعنى الماستر — وهي حادثةُ 2026-08-04");
    assert.ok(src.includes("MASTER_SOURCE_TYPES"), "لا يستعمل التعريفَ الواحد");
  });

  test("والتبديلُ ثلاثيٌّ ذهاباً وعودةً — تفعيلٌ وفاتورةٌ ودَين", () => {
    const src = read(API);
    for (const pair of ["activation", "invoice", "debt", "master-invoice", "master-debt"]) {
      assert.ok(src.includes(pair), `نوعٌ غائبٌ عن الخريطة: ${pair}`);
    }
    // والعودةُ تُبنى بالعكسِ آليّاً فلا تتفرّق الخريطتان
    assert.ok(/Object\.fromEntries/.test(src), "خريطةُ العودة مكتوبةٌ يدويّاً — فتختلف عن الذهاب");
  });

  test("🔒 والتبديلُ ذرّيٌّ: شرطُ النوع الحاليِّ يمنع تحويلاً مزدوجاً", () => {
    const src = read(API);
    assert.ok(/updateMany\(\{[\s\S]{0,120}sourceType: cur/.test(src), "التحديثُ بلا شرطِ النوع الحاليّ");
    assert.ok(/claimed\.count !== 1/.test(src), "لا يتحقّق من نجاحِ الحَجز");
    assert.ok(/status: 409/.test(src), "ضغطتان متتاليتان تُحوّلان مرّتَين بلا إنذار");
  });

  test("🔒 والعزل: الصفُّ من مكتبٍ يملكه وكيلُ الجلسة", () => {
    const src = read(API);
    assert.ok(src.includes("ownsTower(g.session, tx.towerId)"), "بلا فحصِ ملكيّةِ المكتب");
  });

  test("ولا يُخمَّن في حركةٍ يدويّةٍ أو نوعٍ لا مقابلَ له", () => {
    const src = read(API);
    assert.ok(/status: 400/.test(src), "يُحوَّل ما لا مقابلَ له إلى شيءٍ عشوائيّ");
    assert.ok(/حركةٌ يدويّةٌ بلا نوع/.test(src), "لا رسالةَ تشرح للمستخدم");
  });

  test("والأثرُ يُسجَّل بأنّ المجموعَ لم يتغيّر — فالتحويلُ نقلُ دفترٍ لا خلقُ مال", () => {
    const src = read(API);
    assert.ok(src.includes("CONVERT_MONEY_KIND"), "بلا سجلِّ تدقيق");
    assert.ok(/المجموعُ الكلّيُّ لم يتغيّر/.test(src), "السجلُّ لا يُبيّن طبيعةَ الأثر");
  });

  test("🖥️ والزرُّ في صفحة المصروفات والمقبوضات بجانبِ الحذف", () => {
    const page = read("src/app/(app)/cashbox/page.tsx");
    assert.ok(page.includes("convertKind("), "لا دالّةَ تحويلٍ في الواجهة");
    assert.ok(page.includes("/convert"), "الواجهةُ لا تنادي المسار");
    assert.ok(/→ نقديّ|→ ماستر/.test(page), "الزرُّ لا يُظهر الاتّجاه");
    assert.ok(/window\.confirm/.test(page), "تحويلٌ بلا تأكيدٍ — وهو يمسّ توزيعَ المال");
  });
});
