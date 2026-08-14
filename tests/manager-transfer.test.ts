import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ أ-٥ · الموضع ٢: تحويلٌ بين «المبلغ الكلّي» و«حساب الماستر» في حسابات المدير ═══════
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const API = "src/app/api/manager-accounts/tx/route.ts";
const PAGE = "src/app/(app)/manager-accounts/page.tsx";

describe("أ-٥/٢ · تحويلُ الكلّي↔الماستر في حسابات المدير", () => {
  test("🔑 الزوجُ بالأنواع الأربعة القائمة — لا نوعٌ جديدٌ يحتاج كلَّ شاشةٍ أن تتعلّمه", () => {
    const src = read(API);
    // إلى الماستر: صرفٌ من الكلّي + قبضُ ماستر — ومن الماستر عكسُه
    assert.ok(/toMaster \? "expense" : "master-expense"/.test(src), "شقُّ الخروج ليس بالنوعَين القائمَين");
    assert.ok(/toMaster \? "master-receipt" : "receipt"/.test(src), "شقُّ الدخول ليس بالنوعَين القائمَين");
  });

  test("🔒 الزوجُ في معاملةٍ وبعلامةٍ متبادلة «زوج #N»", () => {
    const src = read(API);
    assert.ok(/\$transaction/.test(src), "الشقّان بلا معاملة");
    assert.ok(/زوج #\$\{a\.id\}/.test(src) && /زوج #\$\{b\.id\}/.test(src), "العلامةُ ليست متبادلة");
  });

  test("🗑 والحذفُ زوجاً — بتحقّقٍ من تبادل العلامة وضمن نفس الوكيل", () => {
    const src = read(API);
    assert.ok(/زوج #\(\\d\+\)/.test(src), "الحذفُ لا يقرأ علامةَ الزوج");
    assert.ok(/=== row\.id/.test(src), "بلا تحقّقِ التبادل — رقمٌ مزروعٌ في ملاحظةٍ يجرّ حذفَ حركةٍ بريئة");
    assert.ok(/id: \{ in: \[row\.id, other\.id\] \}, agentId/.test(src), "حذفُ الزوج بلا قيدِ الوكيل");
  });

  test("💰 المصدرُ «الكلّي مباشرة»: managerId يُصفَّر فلا يُمسّ رصيدُ أيّ مدير", () => {
    assert.ok(/managerId: null, byUser/.test(read(API)), "التحويلُ يُنسب لمديرٍ فيُفسد رصيدَه");
  });

  test("🖥️ الزرّان في مربّع الماستر بصفحة حسابات المدير", () => {
    const page = read(PAGE);
    assert.ok(page.includes('submit("convert-to-master")'), "لا زرَّ «من الكلي إلى الماستر»");
    assert.ok(page.includes('submit("convert-from-master")'), "لا زرَّ «من الماستر إلى الكلي»");
  });
});
