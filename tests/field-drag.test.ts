import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ أ-٤ · السحبُ والإفلات: بلا ضغطٍ مطوّلٍ للفأرة، وبإزاحةٍ تفاعليّة ═══════
const ROOT = process.cwd();
const PAGE = fs.readFileSync(path.join(ROOT, "src/app/(app)/field-management/page.tsx"), "utf8");

describe("أ-٤ · سحبُ إدارة الفنيين", () => {
  test("🖱️ الفأرة: لا مؤقّتَ ضغطٍ مطوّل — السحبُ ينطلق من الحركة", () => {
    // المؤقّتُ يُضبط للمس فقط
    assert.ok(/if \(!mouse\) pressTimer\.current = setTimeout\(startDrag/.test(PAGE), "المؤقّتُ ما زال يشمل الفأرة");
    // والحركةُ فوق العتبة بالفأرة تُطلق السحبَ بدل إلغائه
    assert.ok(/p\.mouse \? startDrag\(\)[\s\S]{0,40}: cancelPress\(\)|if \(p\.mouse\) startDrag\(\);[\s\S]{0,60}else cancelPress\(\)/.test(PAGE), "حركةُ الفأرة تُلغي بدل أن تُطلق");
  });

  test("📱 واللمسُ باقٍ على المطوّل — وإلّا تعطّل تمريرُ الشاشة على الهاتف", () => {
    assert.ok(/DRAG_HOLD_MS/.test(PAGE), "أُلغي المؤقّتُ كلّيّاً — فتعطّل تمريرُ اللمس");
    assert.ok(/pointerType === "mouse"/.test(PAGE), "لا تمييزَ بين الفأرة واللمس");
  });

  test("👻 «المسحوبُ يصير شفّافاً قليلاً»", () => {
    assert.ok(/opacity: \.8,\s*transform: `translate3d/.test(PAGE), "النسخةُ الطائرة معتمة");
  });

  test("↔️ «العمودُ فوق عمودٍ ⇒ القديمُ يزيح جانباً» — إزاحةٌ حيّةٌ لا شريطُ إفلات", () => {
    assert.ok(/listShiftX/.test(PAGE), "لا إزاحةَ جانبيّةً للأعمدة");
    assert.ok(/translateX\(\$\{listShiftX\}px\)/.test(PAGE), "الإزاحةُ لا تُطبَّق على العمود");
    assert.ok(!/barBefore|barAfterLast/.test(PAGE), "شريطُ الإفلات الجامد ما زال قائماً");
  });

  test("⬇️ «البطاقةُ فوق بطاقةٍ ⇒ القديمةُ تزيح للأسفل» — قائمةٌ من قبلُ وتبقى", () => {
    assert.ok(/function cardShift/.test(PAGE), "إزاحةُ البطاقات العموديّة زالت");
  });
});
