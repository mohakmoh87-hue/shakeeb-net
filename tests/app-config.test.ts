import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeContent, defaultContent, AD_SLOTS, MAX_IMG, MAX_TEXT, MAX_OFFERS, MAX_QUICK } from "../src/lib/appConfig";

// ═════ تطهيرُ محتوى إعلانات التطبيق (طلبُ محمد 2026-08-29) ═════
// أمانٌ حاسم: لا يصلُ المشتركَ إلا نصٌّ مقصوصٌ وصورةُ data: — لا روابطَ خارجيّةً ولا حقن.

const img = (n: number) => "data:image/png;base64," + "A".repeat(n);

describe("sanitizeContent — تطهيرُ إعلانات التطبيق", () => {
  test("الوارد الفارغ/غير الصالح ⇒ الافتراضيّ (٤ خانات فارغة + اختصارات افتراضيّة)", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      const c = sanitizeContent(bad);
      assert.deepEqual(Object.keys(c.ads).sort(), [...AD_SLOTS].sort());
      for (const s of AD_SLOTS) assert.deepEqual(c.ads[s], { text: "", image: "" });
      assert.deepEqual(c.offers, []);
      assert.deepEqual(c.quick, defaultContent().quick);
    }
  });

  test("يرفضُ الصورةَ غير data:image/ (روابط خارجيّة/سكربت)", () => {
    for (const bad of ["http://evil.com/x.png", "https://x/y.jpg", "javascript:alert(1)", "data:text/html,x", "  data:image/png,x"]) {
      const c = sanitizeContent({ ads: { hero: { text: "ok", image: bad } } });
      assert.equal(c.ads.hero.image, "", `قُبِلت صورةٌ خطرة: ${bad}`);
      assert.equal(c.ads.hero.text, "ok");
    }
  });

  test("يقبلُ data:image/ الصالحة ويرفضُ الكبيرةَ جداً", () => {
    const okImg = img(1000);
    assert.equal(sanitizeContent({ ads: { hero: { text: "", image: okImg } } }).ads.hero.image, okImg);
    assert.equal(sanitizeContent({ ads: { hero: { text: "", image: img(MAX_IMG + 10) } } }).ads.hero.image, "");
  });

  test("يقصُّ نصَّ الإعلان إلى الحدّ", () => {
    const long = "ن".repeat(MAX_TEXT + 50);
    assert.equal(sanitizeContent({ ads: { plan: { text: long, image: "" } } }).ads.plan.text.length, MAX_TEXT);
  });

  test("يُثبّتُ الخاناتِ الأربعَ ويتجاهلُ خاناتٍ غريبة", () => {
    const c = sanitizeContent({ ads: { hero: { text: "h", image: "" }, EVIL: { text: "x", image: "" } } });
    assert.deepEqual(Object.keys(c.ads).sort(), [...AD_SLOTS].sort());
    assert.equal(c.ads.hero.text, "h");
    assert.equal((c.ads as Record<string, unknown>).EVIL, undefined);
  });

  test("يحصرُ العروضَ ويُسقطُ الفارغةَ", () => {
    const offers = Array.from({ length: MAX_OFFERS + 5 }, (_, i) => ({ text: "o" + i, image: "" }));
    offers.push({ text: "", image: "" }); // فارغٌ يُسقَط
    const c = sanitizeContent({ offers });
    assert.ok(c.offers.length <= MAX_OFFERS);
    assert.ok(c.offers.every((o) => o.text || o.image));
  });

  test("يحصرُ الاختصاراتِ ويقصُّها ويُسقطُ الفراغَ", () => {
    const quick = ["  صيانة  ", "", "  ", "تنصيب", ...Array.from({ length: MAX_QUICK + 5 }, (_, i) => "q" + i)];
    const c = sanitizeContent({ quick });
    assert.ok(c.quick.length <= MAX_QUICK);
    assert.equal(c.quick[0], "صيانة"); // مقصوص
    assert.ok(!c.quick.includes("")); // بلا فراغ
  });

  test("التطهيرُ مستقرٌّ (idempotent)", () => {
    const once = sanitizeContent({ ads: { hero: { text: "h", image: img(500) } }, offers: [{ text: "o", image: "" }], quick: ["ص"] });
    assert.deepEqual(sanitizeContent(once), once);
  });
});
