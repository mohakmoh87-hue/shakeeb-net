import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ قاعدة محمد (2026-08-14): «الاستعادةُ لا تُغيّر ديونَ الكارتات» ═══════
// حادثته: ربطُ كارتٍ من الحارس زاد ديونَ الكارتات ٤٤٬٦٥٠ — لأنّ حذف الوهمية يُبقي الدينَ
// بمعاوضةِ إضافةٍ، والاستعادةُ تُعيد السعرَ للمجموع فيُعَدّ مرّتَين.
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const GUARD = "src/app/api/manager/card-guard/route.ts";
const PHANTOM = "src/app/api/manager/phantom-cards/route.ts";

describe("ديون الكارتات لا تتغيّر بالاستعادة", () => {
  test("🔑 استعادةُ الحارس تكتب معاوضةَ إنقاصٍ — لحذفِ الوهمية حصراً", () => {
    const src = read(GUARD);
    assert.ok(/card-debt-sub/.test(src), "لا معاوضةَ — الاستعادةُ تزيد الديون بصمت");
    // فقط حين كان الحذفُ قد أبقى الدين (phantom) — حذفُ المخزن أنقصه فالاستعادةُ تُرجعه صفراً صافياً
    assert.ok(/row\.reason === "phantom"/.test(src), "معاوضةٌ عمياءُ لكلّ استعادة — تُفقد دينَ كارتِ مخزنٍ مستعاد");
    // ولا معاوضةَ مزدوجةً بضغطتَين متسابقتَين
    assert.ok(/claimed\.count === 1 &&/.test(src), "ضغطتان متسابقتان تكتبان معاوضتَين");
  });

  test("🔒 والمعاوضةُ معزولةٌ بوكيل الجلسة وبلا مساسِ رصيدِ مدير", () => {
    const src = read(GUARD);
    assert.ok(/type: "card-debt-sub", amount: row\.price!, agentId, managerId: null/.test(src), "المعاوضةُ بلا عزلٍ أو تنسب لمدير");
  });
});

describe("زرُّ «ربط» يقرأ كلَّ لوحات sas_panels", () => {
  test("🔴 كان يقرأ أعمدةَ المكتب وحدَها — فمكتبٌ بلوحتَين لا يُبحَث كارتُه في الثانية", () => {
    const src = read(PHANTOM);
    assert.ok(/sasPanel\.findMany/.test(src), "الربطُ لا يقرأ sas_panels");
    // ومَن بلا لوحاتٍ مسجّلة يبقى على أعمدة مكتبه (السلوك القديم لا يُكسر)
    assert.ok(/!hasPanels\.has\(t\.id\)/.test(src), "مكتبٌ بلا لوحاتٍ فقد مصدرَ بحثه");
    // 🔒 والعزل: لوحاتُ مكاتب الوكيل حصراً
    assert.ok(/towerId: \{ in: agentTowers\.map/.test(src), "لوحاتٌ بلا قيدِ مكاتب الوكيل");
  });
});
