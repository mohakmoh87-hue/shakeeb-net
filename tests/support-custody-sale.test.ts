import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🔁 بيعُ ذمّةِ مكتبه على بطاقة دعم (قرارُ محمد 2026-11-13) ═════
// كان قرارُ 2026-08-09 يحصر البيعَ أثناء الدعم بمخزن مكتب الدعم، فاختفت عن الفنيّ مادّةٌ
// يحملها معه من مكتبه. والآن تُباع، **بشرطِ أن يبقى المالُ والبضاعةُ متّسقَين**:
// مخزنُ المصدر ينقص · الفاتورةُ لمكتب البطاقة · وسطرُ ترحيلٍ يوثّق انتقالَ البضاعة.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CUSTODY = "src/app/api/field/tech-custody/route.ts";
const COMPLETE = "src/app/api/field/complete/route.ts";

describe("👁️ ذمّةُ الفنيّ تظهر كاملةً أثناء الدعم", () => {
  test("لا ترشيحَ لمواد الذمّة بمكتب الدعم", () => {
    const c = code(CUSTODY);
    assert.ok(!/towerId: supOffice/.test(c), "عاد حجبُ موادّ مكتبه الأصليّ — المادّةُ بيده ولا تظهر له");
    assert.ok(/foreign/.test(c), "المادّةُ الغريبةُ لا تُميَّز للواجهة ⇒ تُباع بلا علمٍ بالترحيل");
  });
  test("والعزلُ باقٍ: ذمّتُه هو، وفنيُّ وكيله وحدَه", () => {
    const c = code(CUSTODY);
    assert.ok(/technicianId = tech\.technicianId/.test(c), "الفنيُّ قد يرى ذمّةَ غيره");
    assert.ok(/t\.agentId !== user!\.agentId/.test(c), "سقط عزلُ الوكيل عن طلب المكتب");
  });
});

describe("🔁 البيعُ يُرحِّل ويوثّق", () => {
  test("المنعُ أثناء الدعم رُفع", () => {
    const c = code(COMPLETE);
    assert.ok(!/ليست من مخزن مكتب الدعم/.test(c), "عاد منعُ بيع ذمّته أثناء الدعم");
  });
  test("وبقي الحدّان: المادّةُ من مكاتب وكيله، وفي ذمّته بكميّةٍ كافية", () => {
    const c = code(COMPLETE);
    assert.ok(/towerId: \{ in: actorTowerIds \}/.test(c), "سقط عزلُ الوكيل عن استعلام المادّة");
    assert.ok(/الكمية بذمّة الفني من/.test(c), "سقط فحصُ كفاية الذمّة");
  });
  test("سطرُ ترحيلٍ موسومٌ يُكتب حين يختلف مكتبُ المادّة عن مكتب البطاقة", () => {
    const c = code(COMPLETE);
    assert.ok(/INV_TRANSFER/.test(c), "لا قيدَ لانتقال البضاعة بين المكتبَين ⇒ لا يتحاسبان عليها");
    assert.ok(/moveTag\(\{ kind: "TRANSFER"/.test(c), "القيدُ بلا وسمٍ آليِّ القراءة ⇒ لا يظهر في سجلّ الترحيلات");
    assert.ok(/fromTower: item\.towerId, toTower: towerId/.test(c), "اتّجاهُ الترحيل مقلوبٌ أو ناقص");
    assert.ok(/\$executeRaw`INSERT INTO audit_logs/.test(c), "إدراجٌ بـRETURNING يُسقط المعاملةَ على حاسبة المكتب");
  });
  test("ومخزنُ الوجهة صافيه صفر: تُنشأ المادّةُ بصفرٍ والنقصُ على المصدر", () => {
    const c = code(COMPLETE);
    assert.ok(/count: 0, towerId,/.test(c), "مادّةُ الوجهة تُنشأ بكميّةٍ غير صفريّة ⇒ مخزونٌ من هواء");
    assert.ok(/tx\.item\.update\(\{ where: \{ id: s\.itemId \}/.test(c), "النقصُ ليس على مادّة المصدر");
  });
});
