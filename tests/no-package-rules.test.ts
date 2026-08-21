import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderTemplate } from "@/lib/messaging";

// ═════ 🎁💰 قاعدتا «من لا باقةَ له» — إملاءُ محمد 2026-08-21 ═════
//   ١· باقتُه في الساس «عرض» ولا باقةَ له عندنا ⇒ **لا يُذكَر** في «تحديث معلومات»
//      (بعد انقضاء العرض سيُفعَّل بباقةٍ حقيقيّة، وبقاؤه بلا باقةٍ لا يؤثّر على شيء).
//   ٢· ولا يصله **مبلغُ اشتراكٍ أبداً** في أيّ رسالة ولو كان في القالب — كي لا يصله «0».

describe("🎁 باقةُ العرض لمن لا باقةَ له لا تُرصَد", () => {
  test("الشرطُ في المزامنة صريحٌ ومربوطٌ بفراغ باقتنا", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/subscriptionSync.ts"), "utf8");
    assert.ok(src.includes("const offerOnEmpty = p.packageId == null && isOfferPackage(u.packageName);"), "لا شرطَ لباقة العرض على الفارغ");
    assert.ok(src.includes("if (sv(u.packageName) && !offerOnEmpty &&"), "الشرطُ لا يمنع الرصد فعلاً");
  });
});

describe("💰 لا مبلغَ اشتراكٍ لمن لا باقةَ له — في كلّ رسالة", () => {
  const tpl = [
    "*تذكير*",
    "اسم المشترك : {اسم_المشترك}",
    "مبلغ الاشتراك : *{مبلغ_الاشتراك}*",
    "اجمالي الديون : *{اجمالي_الديون}*",
  ].join("\n");

  test("بلا باقة (بلا سعر) ⇒ **يُنزَع السطرُ كاملاً** لا يُترَك فارغاً", () => {
    const out = renderTemplate(tpl, { name: "علي", carry: 0 });
    assert.equal(out.includes("مبلغ الاشتراك"), false, "سطرُ المبلغ ما زال يصل من بلا باقة");
    assert.ok(out.includes("علي"), "بقيّةُ الرسالة يجب أن تصل كما هي");
    assert.ok(out.includes("اجمالي الديون"), "سطرُ الديون لا علاقةَ له بالقاعدة");
  });

  test("سعرٌ صفر (باقةٌ بلا سعر) ⇒ يُنزَع أيضاً — «لا يصله مبلغُ اشتراكٍ صفر»", () => {
    const out = renderTemplate(tpl, { name: "علي", price: 0 });
    assert.equal(out.includes("مبلغ الاشتراك"), false, "الصفرُ ما زال يُرسَل");
  });

  test("وسعرٌ حقيقيٌّ يصل كما هو — القاعدةُ لا تمسّ أصحابَ الباقات", () => {
    const out = renderTemplate(tpl, { name: "علي", price: 45000 });
    assert.ok(out.includes("مبلغ الاشتراك : *45000*"), "المبلغُ الحقيقيُّ سقط بالخطأ");
  });

  test("والقاعدةُ في المعبر الوحيد لكلّ القوالب (renderTemplate) لا في مُرسِلٍ بعينه", () => {
    const m = fs.readFileSync(path.join(process.cwd(), "src/lib/messaging.ts"), "utf8");
    assert.ok(m.includes("const priceMissing = priceKeys.every("), "القاعدةُ ليست في المعبر الموحَّد");
    assert.ok(m.includes('const priceKeys = ["price", "مبلغ_الاشتراك"];'), "المتغيّرانِ العربيُّ والإنكليزيُّ غيرُ مشمولَين معاً");
  });
});
