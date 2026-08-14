import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ أ-٢ · المستخدم يُنشئ ويُسمّي ويحذف ويُرتّب الأعمدة — لا المدير وحده ═══════
// حسمه محمد 2026-08-14: «نعم يشمل الحذف أيضاً».
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const API = "src/app/api/field/lists/route.ts";
const PAGE = "src/app/(app)/field-management/page.tsx";

describe("أ-٢ · إدارةُ الأعمدة للمستخدم", () => {
  test("سقط شرطُ field.manage عن المسار كلّه (استعمالاً لا ذِكراً في التوثيق)", () => {
    const src = read(API);
    assert.ok(!/guard\("field\.manage"\)/.test(src), "الإنشاءُ أو الحذفُ ما زال بحارس المدير");
    assert.ok(!/can\([^)]*"field\.manage"\)/.test(src), "فحصُ صلاحيّة المدير ما زال في المسار");
  });

  test("🔒 وبقي العزلُ مزدوجاً في العمليّات الثلاث: الوكيلُ ثمّ الكتابةُ على المكتب", () => {
    const src = read(API);
    // إنشاء: ملكيّةُ اللوحة + كتابةٌ على مكتبها — تعديل/حذف: ملكيّةُ العمود + كتابةٌ على مكتبه
    assert.ok(src.includes("agentOwnsBoard"), "الإنشاءُ بلا عزل وكيل");
    assert.ok(src.includes("canOperateOffice"), "الإنشاءُ بلا قيدِ مكتب المستخدم");
    assert.equal((src.match(/agentOwnsList/g) ?? []).length >= 2, true, "تعديلٌ أو حذفٌ بلا عزل وكيل");
    assert.equal((src.match(/canOperateList/g) ?? []).length >= 2, true, "تعديلٌ أو حذفٌ بلا قيدِ مكتب — مستخدمُ مكتبٍ يعدّل مكتباً آخر");
  });

  test("✏️ التسميةُ الجديدة تُولّد نوعَها — فالإصلاحُ الكسولُ خُتم في أ-٣ ولن يسدّ النقص", () => {
    const src = read(API);
    assert.ok(/if \(data\.name\) await ensureCardType/.test(src), "عمودٌ مُسمّى حديثاً يبقى بلا نوعٍ في «عمليات»");
  });

  test("🖥️ أزرارُ العمود وإضافتُه للمستخدم أيضاً — والفنيُّ مستثنى", () => {
    const page = read(PAGE);
    assert.ok(/const canEditLists = canManage \|\| \(canOperate && !isTech\)/.test(page), "لا رايةَ canEditLists أو الفنيُّ غيرُ مستثنى");
    assert.ok((page.match(/canEditLists/g) ?? []).length >= 4, "الرايةُ معرَّفةٌ ولا تُستعمل في المواضع (الأزرار/الإضافة/النصّ)");
  });
});
