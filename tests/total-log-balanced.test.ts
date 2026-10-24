import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TOTAL_SIGN, totalLogTotal, entrySigned, type TotalLogEntry } from "../src/lib/totalLog";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const daily = (day: string, net: number): TotalLogEntry => ({
  kind: "daily", key: `daily:${day}`, at: `${day}T00:00:00.000Z`, day, label: "تقرير يوميّ",
  amount: net, sign: net >= 0 ? 1 : -1, notes: null, byName: null,
});
const mgr = (type: string, amount: number): TotalLogEntry => ({
  kind: "manager", key: `tx:${type}:${amount}`, at: "2026-10-24T12:00:00.000Z", day: null,
  label: type, type, amount, sign: TOTAL_SIGN[type], notes: null, byName: null,
});

describe("حركاتُ «المبلغ الكلّي الموجود» تساوي رصيدَه بالمعادلة", () => {
  // 🔒 الحارسُ الجوهريّ: مجموعُ الحركات = معادلةُ managerBalances حرفيّاً. فلو أُضيف
  // نوعٌ للمعادلة ونُسي في الإشارات (أو العكس) يسقط هذا قبل النشر.
  test("المجموعُ الموقَّعُ يطابق صافي التقارير − الكارتات − الصرف − الراتب + القبض", () => {
    const cumulativeDaily = 100_000 + 25_000 - 4_000;
    const entries = [
      daily("2026-10-22", 100_000),
      daily("2026-10-23", -4_000),
      daily("2026-10-24", 25_000),
      mgr("receipt", 7_000),
      mgr("expense", 3_000),
      mgr("card-payment", 2_500),
      mgr("salary", 1_500),
    ];
    const byFormula = cumulativeDaily - 2_500 - 3_000 - 1_500 + 7_000;
    assert.equal(totalLogTotal(entries), byFormula);
  });

  test("سطرُ اليومِ السالبِ يُطرح، وقبضُ الإدارةِ وحدَه يُضاف", () => {
    assert.equal(entrySigned(daily("2026-10-23", -4_000)), -4_000);
    assert.equal(entrySigned(mgr("receipt", 7_000)), 7_000);
    for (const t of ["expense", "card-payment", "salary"]) {
      assert.equal(entrySigned(mgr(t, 5_000)), -5_000, `${t} يجب أن يُطرح`);
    }
  });

  test("أنواعُ الإشارات هي أنواعُ المعادلة نفسُها — لا زيادةَ ولا نقص", () => {
    const src = read("src/lib/managerBalances.ts");
    const inFormula = [...src.matchAll(/sumBy\("([a-z-]+)"\)/g)].map((m) => m[1]);
    const totalLine = src.slice(src.indexOf("const totalAvailable ="), src.indexOf("const vaultBalance ="));
    const usedInTotal = inFormula.filter((t) => totalLine.includes(`sumBy("${t}")`));
    assert.deepEqual([...new Set(usedInTotal)].sort(), Object.keys(TOTAL_SIGN).sort());
  });

  test("الماستر لا يدخل القائمة أبداً", () => {
    for (const t of ["master-receipt", "master-expense"]) {
      assert.equal(TOTAL_SIGN[t], undefined, `${t} يجب أن يبقى خارج حركات الكلّي`);
    }
    const route = read("src/app/api/manager-accounts/total-log/route.ts");
    assert.ok(route.includes("type: { in: Object.keys(TOTAL_SIGN) }"), "الاستعلام يجب أن يقتصر على أنواع المعادلة");
  });

  test("المسارُ قراءةٌ محضة — لا كتابةَ ولا حذفَ فيه", () => {
    const route = read("src/app/api/manager-accounts/total-log/route.ts");
    for (const w of ["create(", "createMany", "update(", "updateMany", "delete(", "deleteMany", "$executeRaw"]) {
      assert.ok(!route.includes(w), `المسار يجب ألّا يحتوي ${w}`);
    }
    assert.ok(!/export async function (POST|PATCH|PUT|DELETE)/.test(route), "لا يُصدَّر إلّا GET");
  });

  test("التجميعُ اليوميُّ مصدرُه واحدٌ — المسارانِ ينادِيان المكتبةَ لا ينسخانها", () => {
    const dl = read("src/app/api/manager-accounts/daily-log/route.ts");
    const tl = read("src/app/api/manager-accounts/total-log/route.ts");
    for (const [name, src] of [["daily-log", dl], ["total-log", tl]] as const) {
      assert.ok(src.includes("dailyLogData"), `${name} يجب أن ينادي dailyLogData`);
      assert.ok(!src.includes("moneyTx.findMany"), `${name} يجب ألّا ينسخ تجميعَ moneyTx`);
    }
    assert.ok(read("src/lib/dailyLogAgg.ts").includes("moneyTx.findMany"), "التجميعُ في المكتبة");
  });
});
