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
    assert.ok(src.includes("const sasOffer = isOfferPackage(u.packageName);"), "لا شرطَ لباقة العرض");
    assert.ok(src.includes("if (sv(u.packageName) && !sasOffer &&"), "الشرطُ لا يمنع الرصد فعلاً");
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

// ═════ 🎁 القاعدةُ المكمَّلة: باقةُ عرضٍ ⇒ لا تحديثَ معلوماتٍ إطلاقاً (إملاءُ محمد) ═════
describe("🎁 العرضُ يُسكِت تحديثَ المعلومات كلَّه", () => {
  const SRC = () => fs.readFileSync(path.join(process.cwd(), "src/lib/subscriptionSync.ts"), "utf8");
  test("الهاتفُ والاسمُ والعنوانُ والباقةُ والتاريخُ كلُّها مشروطةٌ بـ«ليس عرضاً»", () => {
    const src = SRC();
    assert.ok(src.includes("const sasOffer = isOfferPackage(u.packageName);"), "لا علمَ للمزامنة بأنّ الباقة عرض");
    for (const [needle, what] of [
      ["if (!sasOffer && sv(u.phone)", "الهاتف"],
      ["if (!sasOffer && sv(u.name)", "الاسم"],
      ["if (!sasOffer && sv(u.address)", "العنوان"],
      ["if (sv(u.packageName) && !sasOffer &&", "الباقة"],
      ["if (!sasOffer && sasPkgIdForDiff != null && !loanSubIds.has(p.id)", "تاريخ الانتهاء"],
    ] as const) {
      assert.ok(src.includes(needle), `${what} ما زال يُرصَد لمشتركٍ على باقة عرض`);
    }
  });

  test("ويبقى استثناءُ الهويّة: اليوزرُ ورقمُ الساس يُرصَدان دائماً", () => {
    const src = SRC();
    const block = src.slice(src.indexOf("const sasOffer = isOfferPackage"), src.indexOf("if (diffs.length) stillDiffering"));
    assert.ok(/f: "netUser"/.test(block), "تغيّرُ اليوزر سقط مع العرض — وهو أخطرُ التغييرات");
    assert.ok(src.includes("if (sasLinkDiff) diffs.push(sasLinkDiff);"), "ربطُ رقم الساس سقط مع العرض — فتعود المكرَّرات");
  });

  test("💸 تفعيلةٌ بمبلغ صفرٍ (قرض) لا تُنتج فرقَ تاريخٍ أبداً", () => {
    const src = SRC();
    assert.ok(src.includes("if (last && Math.round(last.price || 0) <= 0) classified = true;"), "القرضُ ما زال يظهر «تمديدَ أيّام»");
    // 🔑 وشرطُه **آخرُ تفعيلٍ** لا تفعيلةٌ يطابق تاريخُها (تصحيحُ محمد الحرفيّ 2026-08-21)
    assert.ok(src.includes('kind: { in: ["sas", "self", "install"] }, activatedAt: { not: null } },'), "صفُّ الحدث المختومُ لا يمنع الازدواج");
  });

  test("🔎 خياراتُ نوع التغيير في الواجهة — بعدّادٍ لكلّ نوع", () => {
    const ui = fs.readFileSync(path.join(process.cwd(), "src/components/SyncLogModal.tsx"), "utf8");
    assert.ok(ui.includes("const chCounts = useMemo("), "لا عدّادَ لأنواع التغييرات");
    assert.ok(ui.includes("if (chFilter) list = list.filter((r) => (r.changes ?? []).some((c) => c.f === chFilter));"), "المرشِّحُ لا يُطبَّق على القائمة");
    assert.ok(ui.includes("setChFilter(chFilter === f ? \"\" : f)"), "الضغطةُ الثانيةُ لا تُلغي المرشِّح");
  });
});
