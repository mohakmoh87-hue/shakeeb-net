import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ «المالُ لمن قبضه» + «مكتبُ البطاقة يُختار» (قرارا محمد 2026-09-25) ═════
// نقصُ مكتب الشهداء كشف أنّ مالَ التفعيل يُقيَّد لمكتب المشترك لا لمن استلمه، وأنّ بطاقةَ
// تنصيبٍ رُفعت من مكتبٍ آخر تُخرج المادةَ من مخزنٍ وتُدخل المالَ لمكتبٍ ثانٍ.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("مكتبُ القبض في التفعيل", () => {
  const c = code("src/app/api/subscribers/[id]/activate/route.ts");
  test("قيدُ التفعيل وحركاتُه تتبع مكتبَ الموظّف المفعِّل", () => {
    assert.ok(/const cashTowerId = session\?\.towerId != null \? session\.towerId : subscriber\.towerId/.test(c),
      "مكتبُ القبض لم يعد يُشتقّ من جلسة المفعِّل");
    assert.ok(/card2: cardSerial, towerId: cashTowerId/.test(c), "قيدُ التفعيل عاد لمكتب المشترك");
    assert.ok(/sourceType: "activation", sourceId: entry\.id, towerId: cashTowerId/.test(c), "حركةُ التفعيل عادت لمكتب المشترك");
    assert.ok(/sourceType: "master", sourceId: entry\.id, towerId: cashTowerId/.test(c), "حركةُ الماستر عادت لمكتب المشترك");
  });
  test("الدَّينُ والمكافأةُ والقرضُ والرسائلُ تبقى لمكتب المشترك", () => {
    assert.ok(/grantReward\(tx, \{\s*subscriberId, towerId: subscriber\.towerId/.test(c), "المكافأة تبعت مكتبَ القبض");
    assert.ok(/loanDebt\.deleteMany\(\{ where: \{ subscriberId, towerId: subscriber\.towerId \} \}\)/.test(c), "القرض تبع مكتبَ القبض");
    assert.ok(/officeId: subscriber\.towerId,\s*\n\s*phone: subscriber\.phone/.test(c), "رسالةُ التفعيل تبعت مكتبَ القبض");
  });
});

describe("مكتبُ البطاقة", () => {
  const c = code("src/app/api/field/cards/route.ts");
  test("يُقبَل مكتبٌ مختارٌ ويُصادَق ضدّ مكاتب الوكيل", () => {
    assert.ok(/const pickedOffice = !actor\.isTech && b\.officeId != null \? Number\(b\.officeId\) : null/.test(c), "خيارُ المكتب سقط");
    assert.ok(/pickedOffice != null && !agentTowers\.includes\(pickedOffice\)/.test(c), "🔴 مكتبٌ من وكيلٍ آخر يُقبَل — عزلٌ مكسور");
    assert.ok(/if \(pickedOffice != null\) cardOffice = pickedOffice;/.test(c), "المكتبُ المختار لا يُطبَّق");
  });
  test("اقتراحُ المكتب عرضٌ فقط ومقيَّدٌ بمكاتب الوكيل", () => {
    const s = code("src/app/api/field/subscriber-office/route.ts");
    assert.ok(/towerId: \{ in: towerIds \}/.test(s), "🔴 الاقتراحُ يبحث خارج مكاتب الوكيل");
    assert.ok(!/prisma\.\w+\.(create|update|delete|upsert)/.test(s), "مسارُ الاقتراح يكتب في القاعدة");
  });
});
