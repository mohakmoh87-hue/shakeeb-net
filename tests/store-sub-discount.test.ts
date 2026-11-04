import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🏷️ خصمُ مشتركي الوكيل الفعّالين على منتجات المتجر (طلبُ محمد 2026-11-04) ═════
// قرارُه: **الشارةُ تظهر للجميع** دعوةً للاشتراك، و**الخصمُ للفعّال وحدَه** لدى الوكيل
// البائع. ومالُ الطلب يُحسب في الخادم من صفّ المنتج لا من سعرٍ يرسله العميل.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const BROWSE = "src/app/api/app/store/route.ts";
const ORDERS = "src/app/api/app/store/orders/route.ts";

describe("🧮 حسابُ الخصم — دالّتان خالصتان", () => {
  test("النسبةُ تُنظَّف: الفارغُ والسالبُ لا خصمَ، والزائدُ مسقوفٌ بـ٩٠", async () => {
    const { discountPct, MAX_SUB_DISCOUNT } = await import("../src/lib/agentStore");
    assert.equal(discountPct(""), null);
    assert.equal(discountPct(null), null);
    assert.equal(discountPct(0), null);
    assert.equal(discountPct(-5), null);
    assert.equal(discountPct("15"), 15);
    assert.equal(discountPct(14.6), 15);
    assert.equal(discountPct(999), MAX_SUB_DISCOUNT);
  });
  test("السعرُ لا ينقص لغير المستحقّ، وينقص بالنسبة للمستحقّ، والكسرُ مقطوع", async () => {
    const { priceAfterDiscount } = await import("../src/lib/agentStore");
    assert.equal(priceAfterDiscount(BigInt(10000), 15, false), BigInt(10000));
    assert.equal(priceAfterDiscount(BigInt(10000), 15, true), BigInt(8500));
    assert.equal(priceAfterDiscount(BigInt(10000), null, true), BigInt(10000));
    assert.equal(priceAfterDiscount(null, 15, true), null);
    // ٣٣٣٣ × ١٥٪ = ٤٩٩٫٩٥ ⇒ يُقطَع إلى ٤٩٩ (لمصلحة البائع، وبلا عائمة)
    assert.equal(priceAfterDiscount(BigInt(3333), 15, true), BigInt(2834));
  });
});

describe("🔒 الأهليّة يحسمها الخادم بالمعرّفات", () => {
  test("التصفّح: الشارةُ للجميع والخصمُ لمشترِك هذا الوكيل الفعّال", () => {
    const c = code(BROWSE);
    assert.ok(/viewer\.activeSub && viewer\.agentId === i\.agentId/.test(c), "الخصمُ لا يشترط «فعّالٌ لدى الوكيل البائع»");
    assert.ok(/subDiscount: discountPct\(i\.subDiscount\)/.test(c), "النسبةُ لا تُرسَل للعميل ⇒ لا شارةَ لغير المستحقّ");
    assert.ok(/myPrice: priceToNum\(priceAfterDiscount\(/.test(c), "السعرُ المخفَّضُ لا يُحسب في الخادم");
  });
  test("الطلب: السعرُ يُعاد حسابُه من صفّ المنتج ولا يُقرأ من جسم الطلب", () => {
    const c = code(ORDERS);
    assert.ok(/const unit = priceAfterDiscount\(p\.price, p\.subDiscount, subPriced\)/.test(c),
      "سعرُ البند لا يُحسب بالخصم في الخادم ⇒ ما يُعرَض غيرُ ما يُسجَّل");
    assert.ok(/subPriced = viewer\.activeSub && viewerAgentId != null && viewerAgentId === agentId/.test(c),
      "أهليّةُ الخصم في الطلب لا تشترط الفعّالَ لدى الوكيل البائع");
    assert.ok(/goods \+= unit \* BigInt\(it\.qty\)/.test(c), "الإجماليُّ لا يستعمل السعرَ المخفَّض");
    assert.ok(!/b\?\.(price|myPrice|unit|subDiscount)/.test(c), "سعرٌ أو نسبةٌ تُقرَأ من العميل ⇒ خصمٌ مزوَّر");
  });
  test("خصمُ المنتج على البضاعة وحدَها — الرسومُ تُجمع بعدَه كما هي", () => {
    const c = code(ORDERS);
    assert.ok(/const total = goods \+ \(deliveryFee \?\? BigInt\(0\)\)/.test(c), "الرسومُ دخلت الخصمَ أو تغيّر ترتيبُ الحساب");
  });
});

describe("🏬 الوكيلُ يضع النسبةَ من «متجري» وحدَها", () => {
  test("الإنشاءُ والتعديلُ يمرّان بـdiscountPct (لا رقمَ خام)", () => {
    const c = code("src/app/api/store/products/route.ts");
    assert.ok(/subDiscount: discountPct\(b\?\.subDiscount\)/.test(c), "الإنشاءُ لا ينظّف النسبة");
    assert.ok(/data\.subDiscount = discountPct\(b\.subDiscount\)/.test(c), "التعديلُ لا ينظّف النسبة");
    assert.ok(/guard\("store\.manage"\)/.test(c), "المسارُ بلا حارسِ صلاحيّة");
  });
});
