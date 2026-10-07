import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ تعديلُ أسعار البيع من المخزن (طلبُ محمد 2026-10-07) ═════
// غابت خاناتُ الأسعار منذ صار «تعديل» تصحيحَ عددٍ وحدَه (2026-08-25)، فعادت لسعرَي البيع.
// 🔒 ومتوسّطُ الشراء **لا يُحرَّر يدويّاً** بقرار محمد: «المتوسّطُ عمليّةٌ متغيّرةٌ دائماً
//    حسب سعر الشراء» — يبقى محسوباً من الدفعات (movingAverage) وحدَها.
const code = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("أسعارُ البيع تُعدَّل، والمتوسّطُ لا", () => {
  const page = code("src/app/(app)/inventory/page.tsx");
  test("خانتا سعر البيع في نموذج المدير", () => {
    assert.ok(/name: "priceSale", label: "سعر البيع"/.test(page), "🔴 سقطت خانةُ سعر البيع");
    assert.ok(/name: "priceSale2"/.test(page), "سقطت خانةُ سعر البيع الثاني");
  });
  test("🔒 لا خانةَ لمتوسّط الشراء في نموذج التعديل", () => {
    const fieldsBlock = page.slice(page.indexOf("const fields: Field[]"), page.indexOf("return ("));
    assert.ok(!/name: "priceDinar"/.test(fieldsBlock), "🔴 متوسّطُ الشراء صار يُحرَّر يدويّاً — يُفسد كلفةَ المخزون");
  });
  test("المستخدمُ العاديُّ كما كان: كميّةٌ بالزيادة وسعرُ دفعةٍ إلزاميّ", () => {
    assert.ok(/name: "batchBuyPrice", label: "سعر شراء هذه الدفعة \(إلزامي\)", type: "number", required: true/.test(page),
      "تغيّر بابُ المستخدم العاديّ");
  });
  test("كلُّ تغييرِ سعرٍ يُسجَّل في التدقيق", () => {
    const api = code("src/app/api/items/[id]/route.ts");
    assert.ok(/action: "ITEM_PRICE_CHANGE"/.test(api), "🔴 سعرٌ يتغيّر بلا أثرٍ يُقرأ");
    assert.ok(/movedPrice\("سعر البيع", existing\.priceSale, parsed\.data\.priceSale\)/.test(api), "لا يُقارَن السعرُ القديم بالجديد");
  });
  test("المتوسّطُ يُحسب من الدفعات لا من إدخالٍ يدويّ", () => {
    const api = code("src/app/api/items/[id]/route.ts");
    assert.ok(/if \(isIncrease && hasBatchPrice\)[\s\S]{0,160}movingAverage\(/.test(api),
      "🔴 تغيّر حسابُ المتوسّط — الكلفةُ لم تعد من الدفعات");
  });
});
