import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ عمرُ أرشيف البطاقات = شهران (طلبُ محمد 2026-09-27؛ كان أسبوعاً) ═════
const code = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("أرشيفُ البطاقات يُحفظ شهرين", () => {
  const c = code("src/lib/field.ts");
  test("المهلةُ ٦٠ يوماً لا أسبوعاً", () => {
    assert.ok(/export const ARCHIVE_KEEP_DAYS = 60;/.test(c), "🔴 عمرُ الأرشيف لم يعد ٦٠ يوماً");
    assert.ok(/Date\.now\(\) - ARCHIVE_KEEP_DAYS \* 24 \* 3600 \* 1000/.test(c), "المهلةُ لا تُشتقّ من الثابت");
    assert.ok(!/Date\.now\(\) - 7 \* 24 \* 3600 \* 1000/.test(c), "🔴 عادت مهلةُ الأسبوع");
  });
  test("الصورةُ تُحذف مع البطاقة (لا تبقى يتيمةً في القاعدة)", () => {
    assert.ok(/cardPhoto\.deleteMany\(\{ where: \{ cardId: \{ in: ids \} \} \}\)[\s\S]{0,120}taskCard\.deleteMany/.test(c),
      "🔴 الصورُ لا تُحذف قبل البطاقات — تتراكم في القاعدة");
  });
});
