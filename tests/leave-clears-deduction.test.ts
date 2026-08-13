import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ البندان ٤ و٦ · موافقةُ المدير تمسح خصمَ ذلك اليوم (طلبُ محمد 2026-08-14) ═════
//
// (٤) «إذا خُصم الموظّفُ لأنّ المديرَ لم ينتبه لأنّه طالبُ إجازةٍ زمنيّة، فموافقةُ المدير
//     **حتى لو بعد أكثرَ من يوم** ستمسح الخصمَ عن اليوم الذي خُصم به».
// (٦) «موافقةُ المدير تُزيل أيَّ خصمٍ بسبب أيّ حادث مخالفةِ بصمةٍ في الوقت الذي طلبه».
//
// ⛔ **وقاعدةُ محمد الحاكمة: «إذا أُعطي الموظّفُ راتبَه فلن يُمسَح شيءٌ له بعدها».**

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const API = () => read("src/app/api/field/leaves/route.ts");

describe("البندان ٤ و٦ · الموافقةُ تمسح الخصم", () => {
  test("المسحُ عند الموافقة على **الزمنيّة** لا على إجازة اليوم", () => {
    // إجازةُ اليوم الكامل لا بصمةَ فيها أصلاً ⇒ لا خصمَ بصمةٍ يُمسَح
    assert.match(API(), /parsed\.data\.status === "approved" && leave\.kind === "time" && leave\.dayKey/,
      "الشرطُ ليس «موافقةٌ على زمنيّةٍ ليومٍ معروف»");
  });

  test("🔑 بأثرٍ رجعيّ: يُبحَث عن صفّ **يوم الإجازة** لا يوم الموافقة", () => {
    // «حتى لو بعد أكثرَ من يوم» — فلو قُرئ يومُ القرار لَما مُسِح شيءٌ في الحالة التي طلبها
    assert.match(API(), /where: \{ technicianId: leave\.technicianId, dayKey: leave\.dayKey \}/,
      "الصفُّ يُقرأ بغير يوم الإجازة ⇒ الموافقةُ المتأخّرةُ لا تمسح شيئاً");
  });

  test("⛔ يومٌ مختومٌ بكشفٍ: لا يُمسَح — **ويُقال ذلك صريحاً**", () => {
    const api = API();
    assert.match(api, /if \(rec\.salaryStatementId != null\)/, "لا فحصَ لختم الكشف");
    assert.match(api, /sealedNotice = /, "لا ملاحظةَ تُبلَّغ ⇒ نجاحٌ صامتٌ يُوهم المسح");
    assert.match(api, /مختومٌ بكشف راتبٍ مصروف/, "الملاحظةُ لا تشرح السبب");
    // والواجهةُ تُظهرها — فالصمتُ هنا يُعيد شكوى «لم أنتبه»
    const ui = read("src/components/LeaveReview.tsx");
    assert.match(ui, /if \(d\.sealedNotice\) alert/, "الواجهةُ تُهمل ملاحظةَ «مختوم»");
    assert.match(ui, /d\.clearedDeduction > 0/, "الواجهةُ لا تُخبر بأنّ الخصمَ مُسِح");
  });

  test("🛡️ الحَجزُ قبل الأثر: لا مسحَ مزدوجٌ ولا مسحٌ بعد ختمٍ طرأ", () => {
    const api = API();
    assert.match(api, /where: \{ id: rec\.id, deductionClearedAt: null, salaryStatementId: null \}/,
      "جملةُ المسح بلا شرطَي «لم يُمسَح» و«غيرُ مختوم» ⇒ سباقٌ يمسح خصماً من كشفٍ مصروف");
    assert.match(api, /if \(done\.count === 1\)/, "لا فحصَ لنتيجة الحَجز");
  });

  test("🛡️ الأصلُ محفوظٌ والسببُ مكتوبٌ — سجلٌّ لا محو", () => {
    const api = API();
    assert.match(api, /deductionClearedAmount: total/, "المبلغُ الأصليُّ لا يُحفظ ⇒ لا يُعرَف ما أُعفي عنه");
    assert.match(api, /deductionClearReason: `موافقةُ إجازةٍ زمنيّة #\$\{leave\.id\}`/, "السببُ لا يُربط بالإجازة");
    assert.match(api, /action: "CLEAR_DEDUCTION"/, "لا سجلَّ تدقيقٍ للمسح");
  });

  test("لا يُمسَح ما لا خصمَ فيه", () => {
    assert.match(API(), /if \(rec && total > 0\)/, "يُكتب أثرُ مسحٍ ليومٍ بلا خصم");
  });

  test("العزلُ والصلاحيّةُ قائمانِ كما كانا", () => {
    const api = API();
    assert.match(api, /guard\("field\.payroll"\)/, "صلاحيّةٌ غيرُ صلاحيّة الرواتب");
    assert.match(api, /ownsTower\(g\.session, leave\.towerId\)/, "لا فحصَ لملكيّة مكتب الإجازة");
    // والقرارُ لا يُعاد على طلبٍ مُقرَّرٍ سلفاً — فلا تُمسَح خصومٌ بموافقةٍ مكرَّرة
    assert.match(api, /leave\.status !== "pending"/, "طلبٌ مُقرَّرٌ يُقبَل مرّةً ثانية");
  });
});
