import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ «إنقاص كمية المخزن وحذف المواد» صلاحيّةٌ مستقلّة (طلبُ محمد 2026-10-19) ═════
// حسابُ «متابعة مكتب شكيب» مديرٌ ⇒ كان يُنقص الكميّات ويحذف المواد في مكاتب شكيب الأربعة.
// الآن: الزيادةُ والتسعيرُ له، والإنقاصُ والحذفُ خلف صلاحيّةٍ تُمنَع عنه وحدَه.
const code = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("صلاحيّةُ إنقاص المخزن", () => {
  test("معرَّفةٌ ومعروضةٌ للمدير في قائمة الصلاحيّات", () => {
    const rbac = code("src/lib/rbac.ts");
    assert.ok(/\| "inventory\.reduce"/.test(rbac), "🔴 الصلاحيّةُ غيرُ معرَّفة");
    assert.ok(/key: "inventory\.reduce", label: "إنقاص كمية المخزن وحذف المواد"/.test(rbac), "لا تظهر في شاشة الصلاحيّات فلا تُمنَع");
  });
  const api = code("src/app/api/items/[id]/route.ts");
  test("🔒 الخادمُ يمنع الإنقاص (لا إخفاءَ زرٍّ فقط)", () => {
    assert.ok(/parsed\.data\.count < before && !can\(g\.session, "inventory\.reduce"\)/.test(api),
      "🔴 يمرّ إنقاصُ الكميّة بلا الصلاحيّة");
  });
  test("🔒 والحذفُ كذلك", () => {
    assert.ok(/if \(!can\(g\.session, "inventory\.reduce"\)\)[\s\S]{0,200}status: 403/.test(api), "🔴 يمرّ حذفُ المادّة بلا الصلاحيّة");
  });
  test("الزيادةُ والتسعيرُ لم تُمَسّا — ولا مسارُ المستخدم العاديّ", () => {
    assert.ok(/لا يمكنك إنقاص الكمية/.test(api), "حرسُ المستخدم العاديّ سقط");
    assert.ok(/movingAverage\(/.test(api), "حسابُ المتوسّط عند الزيادة تغيّر");
  });
  test("زرُّ الحذف يختفي عمّن مُنع", () => {
    assert.ok(/canDelete=\{isAdmin && can\("inventory\.reduce"\)\}/.test(code("src/app/(app)/inventory/page.tsx")),
      "🔴 زرُّ الحذف ظاهرٌ لمن لا يملك الصلاحيّة");
  });
});
