import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ ± حصّةُ إجازاتِ فترةٍ واحدة (طلبُ محمد 2026-10-13) ═════
// «إذا كان له إجازتان هذا الشهر وقرّرتُ في أيّ وقتٍ إضافةَ واحدةٍ أو حذفَها» — تعديلٌ موسومٌ
// ببداية الفترة، لا يمسّ الحصّةَ الشهريّةَ الدائمة، وينقضي بانقضاء فترته.
const code = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("تعديلُ حصّة الإجازات لفترةٍ واحدة", () => {
  const lib = code("src/lib/salary.ts");
  test("التعديلُ لا يسري إلّا على فترته", () => {
    assert.ok(/periodFrom && t\?\.leaveQuotaAdjPeriod === periodFrom \? \(t\?\.leaveQuotaAdj \?\? 0\) : 0/.test(lib),
      "🔴 التعديلُ يسري على كلّ الفترات — يصير حصّةً دائمة");
    assert.ok(/Math\.max\(0, base \+ adj\)/.test(lib), "الحصّةُ قد تصير سالبة");
  });
  test("كلُّ موضعٍ يحسب الحصّة يستعمل حصّةَ الفترة", () => {
    for (const rel of ["src/app/api/field/leaves/route.ts", "src/app/api/field/salary/route.ts", "src/app/api/field/technicians/route.ts"]) {
      const c = code(rel);
      assert.ok(/periodLeaveQuota\(/.test(c), `${rel}: لا يستعمل حصّةَ الفترة`);
      assert.ok(!/effectiveLeaveQuota\(/.test(c), `🔴 ${rel}: بقي يحسب الحصّةَ بلا تعديل الفترة`);
    }
  });
  const api = code("src/app/api/field/leave-quota/route.ts");
  test("الحرّاس: صلاحيّةُ الرواتب · العزل · لا مساسَ بفترةٍ مُسدَّدة · لا نزولَ تحت المأخوذ", () => {
    assert.ok(/guard\("field\.payroll"\)/.test(api), "🔴 بلا صلاحيّة الرواتب");
    assert.ok(/ownsTower\(g\.session, tech\.towerId\)/.test(api), "🔴 بلا عزلٍ بمكاتب المستخدم");
    assert.ok(/period\.to <= sealed\.periodTo/.test(api), "🔴 تُعدَّل حصّةُ فترةٍ مُسدَّدةٍ بكشفِ راتب");
    assert.ok(/delta < 0 && after < used/.test(api), "🔴 تُنقَص الحصّةُ تحت ما أخذه فعلاً");
  });
  test("كلُّ تعديلٍ يُسجَّل في التدقيق", () => {
    assert.ok(/action: "LEAVE_QUOTA_ADJUST"/.test(api), "🔴 تعديلُ حصّةٍ بلا أثرٍ يُقرأ");
  });
  test("الزرّان حيث يظهر الرصيد", () => {
    const ui = code("src/components/TechnicianManager.tsx");
    assert.ok(/adjustQuota\(t, -1\)/.test(ui) && /adjustQuota\(t, 1\)/.test(ui), "🔴 سقط زرّا ± من بطاقة الفنيّ");
  });
});
