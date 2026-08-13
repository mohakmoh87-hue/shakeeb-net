import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ البند ٧ · «يمكن للمدير مسحُ أيّ خصمٍ ولأيّ سبب» (طلبُ محمد 2026-08-14) ═════
//
// «وليس فقط البصمة». والخصمُ يسكن **صفَّ الحضور نفسَه** (`lateDeduction`/`earlyDeduction`)
// لا جدولاً منفصلاً — قِيس. فالمسحُ تصفيرُ حقلَين، وهنا الخطر: **تصفيرٌ بلا أثرٍ يُراجَع**
// يجعل كشفَ الراتب غيرَ قابلٍ للتفسير، وشرطُ محمد الدائم «ألّا يضيع شيء».
//
// ⛔ **والقاعدةُ الحاكمةُ بنصّه: «إذا أُعطي الموظّفُ راتبَه فلن يُمسَح شيءٌ له بعدها».**

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const API = () => read("src/app/api/field/attendance/clear-deduction/route.ts");

describe("البند ٧ · مسحُ الخصم", () => {
  test("⛔ يومٌ مختومٌ بكشفِ راتبٍ لا يُمسَح — رفضٌ صريحٌ لا صمت", () => {
    const api = API();
    assert.match(api, /if \(rec\.salaryStatementId != null\)/, "لا فحصَ لختم كشف الراتب");
    assert.match(api, /ولا يُمسَح خصمٌ بعد صرف الراتب/, "الرفضُ بلا رسالةٍ تشرح السبب");
    assert.match(api, /status: 409/, "الرفضُ ليس بحالةٍ صريحة");
    // 🔑 والشرطُ مكرَّرٌ في **جملة التحديث** أيضاً: لو خُتم اليومُ بين الفحص والكتابة
    //   (سباقُ لحظةٍ) لَمُسِح خصمٌ من كشفٍ مصروف. فالحرسُ في الشرط لا في التوقيت.
    assert.match(api, /where: \{ id: rec\.id, deductionClearedAt: null, salaryStatementId: null \}/,
      "جملةُ التحديث بلا شرطِ «غيرُ مختوم» ⇒ سباقٌ يمسح خصماً من كشفٍ مصروف");
    // والواجهةُ لا تعرض الزرَّ لمختومٍ — فلا يُضغَط ما سيُرفَض
    assert.match(read("src/app/(app)/attendance/page.tsx"), /r\.salaryStatementId == null \?/, "الزرُّ يظهر ليومٍ مختوم");
  });

  test("🛡️ المسحُ سجلٌّ لا محوٌ: مَن ومتى ولماذا و**كم كان**", () => {
    const api = API();
    for (const f of ["deductionClearedBy", "deductionClearedAt", "deductionClearReason", "deductionClearedAmount"]) {
      assert.match(api, new RegExp(f), `حقلٌ غائبٌ عن الكتابة: ${f}`);
    }
    // 🔑 و`deductionClearedAmount` هو الأهمّ: بعد التصفير لا يُعرَف ما أُعفي عنه بلاه
    assert.match(api, /deductionClearedAmount: total/, "الأصلُ لا يُحفظ ⇒ لا يُعرَف ما أُعفي عنه");
    assert.match(api, /const total = \(rec\.lateDeduction \?\? 0\) \+ \(rec\.earlyDeduction \?\? 0\)/, "الأصلُ يُحسَب خطأً");
    // وسجلُّ تدقيقٍ مستقلٌّ عن الصفّ
    assert.match(api, /action: "CLEAR_DEDUCTION"/, "لا سجلَّ تدقيقٍ للمسح");
  });

  test("🛡️ السببُ إلزاميٌّ على الخادم لا في الواجهة وحدَها", () => {
    const api = API();
    assert.match(api, /reason: z\.string\(\)\.trim\(\)\.min\(1, "سبب المسح مطلوب"\)/, "السببُ غيرُ إلزاميّ");
    // وحدٌّ أعلى: نصٌّ بلا حدٍّ يُكتب في صفٍّ يُقرأ في كلّ كشفٍ
    assert.match(api, /\.max\(400\)/, "السببُ بلا حدٍّ أعلى");
  });

  test("🛡️ ضغطتان لا تُسجّلان مسحَين ولا تطمس الأصلَ بصفر", () => {
    // الحَجزُ قبل الأثر: `deductionClearedAt: null` في شرط التحديث. وبلاه تُعاد الكتابةُ
    // فيصير `deductionClearedAmount = 0` (لأنّ الخصمَ صار صفراً) ⇒ **يضيع أثرُ ما أُعفي عنه**.
    const api = API();
    assert.match(api, /deductionClearedAt: null/, "لا شرطَ «لم يُمسَح سلفاً»");
    assert.match(api, /if \(claimed\.count !== 1\)/, "لا فحصَ لنتيجة الحَجز");
  });

  test("🔒 العزلُ والصلاحيّة: مكتبُ الفنيّ من مكاتب الوكيل، والصلاحيّةُ صلاحيّةُ رواتب", () => {
    const api = API();
    assert.match(api, /guard\("field\.payroll"\)/, "صلاحيّةٌ غيرُ صلاحيّة الرواتب");
    assert.match(api, /agentTowerIds\(g\.session \?\? null\)/, "لا تحديدَ لمكاتب الوكيل");
    // 🔑 ويُقرأ مكتبُ **الفنيّ** لا صفِّ الحضور وحدَه: `Attendance.towerId` مكتبُ البصمة
    //   وقد يكون مكتبَ دعمٍ (أ-١٠)، والمرجعُ مكتبُه الأصليّ.
    assert.match(api, /prisma\.technician\.findUnique/, "لا يُقرأ مكتبُ الفنيّ الأصليّ");
    assert.match(api, /!owns\(tech\?\.towerId\) && !owns\(rec\.towerId\)/, "العزلُ يعتمد مصدراً واحداً");
  });

  test("لا يُمسَح ما لا خصمَ فيه — ولا يُبلَغ نجاحٌ كاذب", () => {
    assert.match(API(), /لا يوجد خصمٌ على هذا اليوم/, "مسحٌ بلا خصمٍ يُبلَّغ نجاحاً");
  });
});
