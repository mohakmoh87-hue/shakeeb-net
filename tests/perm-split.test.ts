import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { can, LEGACY_IMPLIES, SPLIT_PAIRS, bakeSplitPairs } from "../src/lib/rbac";

// ═════ فكُّ ربط الأزواج الأربعة (طلبُ محمد 2026-08-29) ═════
// كانت «إدارة الفنيين» تُلصِقُ «رؤية رواتب الفنيين» فيستحيلُ نزعُها — والآن مستقلّة.

describe("فكُّ ربط الصلاحيّات المفصولة", () => {
  test("الأبُ لم يعد يَستلزمُ الابنَ في can (الأزواج الأربعة)", () => {
    for (const [parent, child] of SPLIT_PAIRS) {
      assert.equal(
        can({ isAdmin: false, permissions: [parent] }, child),
        false,
        `«${parent}» ما زال يمنح «${child}» ضمناً — لم يُفكَّ الربط`,
      );
    }
  });

  test("الابنُ الصريحُ ما زال يعمل، ومنحُ الأب لا يُسقط منحَ الابن", () => {
    assert.equal(can({ permissions: ["field.manage", "field.payroll"] }, "field.payroll"), true);
    assert.equal(can({ permissions: ["field.manage"] }, "field.manage"), true);
  });

  test("offices.manage (مفتاحٌ مُلغىً) ما زال يَستلزمُ أبناءَه", () => {
    for (const child of ["offices.edit", "offices.delete", "backup.manage", "agent.settings", "rewards.config"] as const) {
      assert.equal(can({ permissions: ["offices.manage"] as never }, child), true, `offices.manage لم يعد يمنح «${child}»`);
    }
  });

  test("بعد الفصل: منعُ الأب لم يعد يمنعُ الابنَ (لذا يُثبَّتُ المنعُ صراحةً في الردم)", () => {
    // مديرٌ مُنِع عنه «إدارة الفنيين» — «الرواتب» لم تعد تُمنَع تبعاً، فلولا الردمُ لَتسرّبت
    assert.equal(can({ isAdmin: true, deniedPermissions: ["field.manage"] }, "field.payroll"), true);
    // والمنعُ الصريحُ للابن ما زال يغلب صفةَ المدير
    assert.equal(can({ isAdmin: true, deniedPermissions: ["field.payroll"] }, "field.payroll"), false);
  });

  test("لا زوجَ مفصولٍ باقٍ في LEGACY_IMPLIES (يبقى offices.manage وحدَه)", () => {
    for (const [parent] of SPLIT_PAIRS) {
      assert.equal(LEGACY_IMPLIES[parent], undefined, `«${parent}» ما زال في LEGACY_IMPLIES`);
    }
    assert.ok(LEGACY_IMPLIES["offices.manage"], "offices.manage يجب أن يبقى مفتاحاً مُلغىً");
    assert.equal(Object.keys(LEGACY_IMPLIES).length, 1);
  });
});

describe("ردمُ bakeSplitPairs — يُثبّت الأثرَ الفعليَّ صراحةً بلا فقدٍ ولا كسب", () => {
  test("يُثبّتُ الابنَ في المنح لمن يملك الأبَ", () => {
    const r = bakeSplitPairs(["field.manage"], []);
    assert.ok(r);
    assert.ok(r!.permissions.includes("field.payroll"));
    assert.ok(r!.permissions.includes("field.manage"));
  });

  test("يُثبّتُ الابنَ في المنع لمديرٍ ممنوعٍ عنه الأب", () => {
    const r = bakeSplitPairs([], ["field.manage"]);
    assert.ok(r);
    assert.deepEqual(r!.permissions, []);
    assert.ok(r!.denied.includes("field.payroll"));
  });

  test("لا تغييرَ ⇒ null (الابنُ موجودٌ سلفاً أو الأبُ غائب)", () => {
    assert.equal(bakeSplitPairs(["field.manage", "field.payroll"], []), null);
    assert.equal(bakeSplitPairs(["reports.view"], []), null);
    assert.equal(bakeSplitPairs([], []), null);
  });

  test("يُثبّتُ عدّةَ أبناءٍ دفعةً واحدة", () => {
    const r = bakeSplitPairs(["users.manage", "subscribers.manage"], []);
    assert.ok(r);
    assert.ok(r!.permissions.includes("audit.view"));
    assert.ok(r!.permissions.includes("subscribers.import"));
  });

  test("إعادةُ التنفيذ ذرّيّةٌ (idempotent): نتيجةُ الردم لا تتغيّر بردمٍ ثانٍ", () => {
    const once = bakeSplitPairs(["field.manage"], []);
    assert.ok(once);
    assert.equal(bakeSplitPairs(once!.permissions, once!.denied), null);
  });
});
