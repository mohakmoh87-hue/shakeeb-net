import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TOTAL_SIGN, MASTER_SIGN, totalLogTotal, entrySigned, withRunningBalance, type TotalLogEntry } from "../src/lib/totalLog";

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

  // 🔒 «كم أصبح المبلغ» بعد كلّ حركة — بمثال محمد حرفيّاً
  test("الرصيدُ الجاري يتراكم من الأقدم: ١٠٠ ← صرفُ ٥٠ ⇒ ٥٠ ← قبضُ ١٠٠ ⇒ ١٥٠", () => {
    // الأحدثُ أوّلاً كما يُرسله المسار
    const newestFirst: TotalLogEntry[] = [
      { ...mgr("receipt", 100_000), at: "2026-10-24T12:00:00.000Z", key: "c" },
      { ...mgr("expense", 50_000), at: "2026-10-24T11:00:00.000Z", key: "b" },
      daily("2026-10-23", 100_000),
    ];
    const rows = withRunningBalance(newestFirst);
    assert.deepEqual(rows.map((r) => r.balanceAfter), [150_000, 50_000, 100_000]);
    // رصيدُ أوّلِ سطرٍ معروضٍ = المجموعُ الكلّيّ
    assert.equal(rows[0].balanceAfter, totalLogTotal(newestFirst));
    // والترتيبُ المعروضُ لم يُمَسّ
    assert.deepEqual(rows.map((r) => r.key), ["c", "b", "daily:2026-10-23"]);
  });

  test("الرصيدُ الجاري يسمح بالسالب ولا يُقصّ", () => {
    const rows = withRunningBalance([mgr("expense", 30_000), daily("2026-10-20", 10_000)]);
    assert.deepEqual(rows.map((r) => r.balanceAfter), [-20_000, 10_000]);
  });

  test("الماستر لا يدخل القائمة أبداً", () => {
    for (const t of ["master-receipt", "master-expense"]) {
      assert.equal(TOTAL_SIGN[t], undefined, `${t} يجب أن يبقى خارج حركات الكلّي`);
    }
    const route = read("src/app/api/manager-accounts/total-log/route.ts");
    assert.ok(route.includes("type: { in: Object.keys(TOTAL_SIGN) }"), "الاستعلام يجب أن يقتصر على أنواع المعادلة");
  });

  test("المسارُ يُرسل الرصيدَ الجاري محسوباً في الخادم", () => {
    const route = read("src/app/api/manager-accounts/total-log/route.ts");
    assert.ok(route.includes("withRunningBalance(entries)"), "entries يجب أن تمرّ بالرصيد الجاري");
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

describe("حركاتُ «حساب الماستر» — نظيرُ الكلّيّ، ودفترٌ لا يختلط به", () => {
  const MASTER = "src/app/api/manager-accounts/master-log/route.ts";
  const TOTAL = "src/app/api/manager-accounts/total-log/route.ts";

  test("الدفتران لا يختلطان: أنواعُ كلٍّ خارج الآخر", () => {
    for (const t of Object.keys(MASTER_SIGN)) assert.equal(TOTAL_SIGN[t], undefined, `${t} في دفتر الكلّيّ`);
    for (const t of Object.keys(TOTAL_SIGN)) assert.equal(MASTER_SIGN[t], undefined, `${t} في دفتر الماستر`);
    assert.deepEqual(Object.keys(MASTER_SIGN).sort(), ["master-expense", "master-receipt"]);
  });

  test("الماستر يحصر حركاتِ المكاتب بوسمه، والكلّيّ يستثنيه", () => {
    const m = read(MASTER), t = read(TOTAL);
    assert.ok(m.includes("onlyMaster"), "الماستر يحصر بـonlyMaster");
    assert.ok(!m.includes("notMaster"), "ولا يستعمل notMaster");
    assert.ok(m.includes("type: { in: Object.keys(MASTER_SIGN) }"), "أنواعُ المدير محصورة");
    assert.ok(t.includes("dailyLogData"), "والكلّيُّ على تجميعه (notMaster داخله)");
  });

  test("لا قصَّ للحركات في الماستر — القصُّ يُفسد «أصبح» والمجموع", () => {
    const m = read(MASTER);
    assert.ok(!/take:\s*\d+/.test(m), "لا take في استعلامات السجلّ");
  });

  test("مسارُ الماستر قراءةٌ محضة", () => {
    const m = read(MASTER);
    for (const w of ["create(", "createMany", "update(", "updateMany", "delete(", "deleteMany", "$executeRaw"]) {
      assert.ok(!m.includes(w), `يجب ألّا يحتوي ${w}`);
    }
    assert.ok(!/export async function (POST|PATCH|PUT|DELETE)/.test(m), "لا يُصدَّر إلّا GET");
  });

  test("رصيدُ الماستر المحسوبُ = مجموعُ حركاته بإشاراتها", () => {
    const daily = (day: string, net: number): TotalLogEntry => ({
      kind: "daily", key: `mday:${day}`, at: `${day}T00:00:00.000Z`, day, label: "تقرير يوميّ",
      amount: net, sign: net >= 0 ? 1 : -1, notes: null, byName: null,
    });
    const mtx = (type: string, amount: number): TotalLogEntry => ({
      kind: "manager", key: `mtx:${type}`, at: "2026-10-24T10:00:00.000Z", day: null,
      label: type, type, amount, sign: MASTER_SIGN[type], notes: null, byName: null,
    });
    const entries = [daily("2026-10-20", 80_000), daily("2026-10-21", -5_000), mtx("master-receipt", 10_000), mtx("master-expense", 20_000)];
    assert.equal(totalLogTotal(entries), 80_000 - 5_000 + 10_000 - 20_000);
    const rows = withRunningBalance([...entries].reverse());
    assert.equal(rows[0].balanceAfter, 65_000, "رصيدُ أوّلِ سطرٍ معروضٍ = المجموع");
    assert.equal(entrySigned(mtx("master-expense", 7_000)), -7_000);
  });

  test("الواجهةُ مصدرٌ واحدٌ للاثنين — لا نسختان تفترقان", () => {
    const page = read("src/app/(app)/manager-accounts/page.tsx");
    assert.equal((page.match(/<MoneyLog\s/g) ?? []).length, 2, "المكوّنُ نفسُه للكلّيّ وللماستر");
    assert.ok(!page.includes("balanceAfter"), "لا نسخةَ عرضٍ مضمَّنةٌ في الصفحة");
  });
});
