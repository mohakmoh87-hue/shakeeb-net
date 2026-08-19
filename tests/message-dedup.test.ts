import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { messageDedupKey, baghdadDayKey } from "../src/lib/messageDedup";

// ═════ حارسُ تكرار الرسائل (طلبُ محمد 2026-08-19) ═════
// «رسالةٌ واحدةٌ من كلّ قالبٍ لكلّ مشتركٍ خلال ٢٤ ساعة … حارسٌ منيعٌ جدّاً.»
// الأمنعُ فهرسٌ فريدٌ جزئيٌّ على `dedupKey` — وهذه الاختباراتُ تحرس منطقَ المفتاح
// (فهو أساسُ الفهرس) + تُثبت أنّ العزلَ وتخطّي المكرَّرين مبنيّان في المسارات.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
// إسقاطُ التعليقات كي لا تُطابَق أمثلةُ الكود الموصوفة فيها
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("مفتاحُ منعِ التكرار", () => {
  test("نفسُ (الوكيل·المشترك·القالب·اليوم) ⇒ نفسُ المفتاح تماماً (فالفهرسُ يمنع الثاني)", () => {
    const a = messageDedupKey(7, 100, "expiring");
    const b = messageDedupKey(7, 100, "expiring");
    assert.equal(a, b);
    assert.ok(a && a.includes(":100:expiring:"), "المفتاحُ لا يحمل المشتركَ والقالب");
  });

  test("🔒 العزل: وكيلان مختلفان ⇒ مفتاحان مختلفان (لا تصادم بين مستأجرَين)", () => {
    assert.notEqual(messageDedupKey(7, 100, "expiring"), messageDedupKey(8, 100, "expiring"));
  });

  test("قوالبُ محمد الأربعة تُنتج مفاتيحَ متمايزة — رسالةٌ من كلٍّ لا تمنع الأخرى", () => {
    const keys = ["expiring", "subSummary", "activation", "bulk"].map((t) => messageDedupKey(7, 100, t));
    assert.equal(new Set(keys).size, 4, "قالبان يتشاركان مفتاحاً — أحدهما سيمنع الآخر خطأً");
  });

  test("البثُّ بلا قالبٍ يسقط إلى «bulk» (لا NULL) — «ارسال للكل واحدة»", () => {
    assert.ok(messageDedupKey(7, 100, null)?.includes(":bulk:"));
    assert.ok(messageDedupKey(7, 100, "")?.includes(":bulk:"));
    assert.ok(messageDedupKey(7, 100, "   ")?.includes(":bulk:"));
  });

  test("رسالةٌ بلا مشترك (تقاريرُ المدير/المزامنة) ⇒ NULL فلا تُدَّدَع", () => {
    assert.equal(messageDedupKey(7, null, "report"), null);
  });

  test("يومُ بغداد سلسلةُ تاريخٍ صالحة، وينقلب مع حدّ اليوم +3", () => {
    assert.match(baghdadDayKey(new Date("2026-08-19T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
    // 21:30 UTC = 00:30 بغداد اليومِ التالي
    assert.equal(baghdadDayKey(new Date("2026-08-19T21:30:00Z")), "2026-08-20");
    assert.equal(baghdadDayKey(new Date("2026-08-19T20:30:00Z")), "2026-08-19");
  });
});

describe("الحارسُ مبنيٌّ في المسارات (لا عرضٌ فقط)", () => {
  test("البثُّ المصطفّ: dedupKey + skipDuplicates (ON CONFLICT DO NOTHING)", () => {
    const c = code("src/app/api/messages/route.ts");
    assert.ok(/dedupKey: messageDedupKey\(/.test(c), "صفوفُ البثّ لا تحمل dedupKey");
    assert.ok(/createMany\(\{ data: rows, skipDuplicates: true \}\)/.test(c),
      "createMany بلا skipDuplicates — فالفهرسُ يرمي بدل أن يتخطّى");
  });

  test("الفرديُّ (target=one) لا يُدَّدَع — الإرسالُ المتعمَّدُ لا يُقيَّد", () => {
    const c = code("src/app/api/messages/route.ts");
    assert.ok(/target !== "one" &&\s*await alreadySentToday/.test(c),
      "فحصُ التكرار غيرُ مشروطٍ بـtarget!==one — سيمنع الإرسالَ الفرديّ المتعمَّد");
  });

  test("الملخّصُ والتفعيلُ يفحصان قبل الإرسال ويضعان dedupKey", () => {
    const s = code("src/app/api/subscribers/[id]/summary/route.ts");
    assert.ok(/alreadySentToday\(subscriber\.id, "subSummary"/.test(s), "الملخّصُ بلا فحصٍ قبليّ");
    assert.ok(/dedupKey: messageDedupKey\(/.test(s), "الملخّصُ بلا dedupKey");
    const a = code("src/app/api/subscribers/[id]/activate/route.ts");
    assert.ok(/alreadySentToday\(a\.subscriberId, "activation"/.test(a), "التفعيلُ بلا فحصٍ قبليّ");
    assert.ok(/dedupKey: messageDedupKey\(/.test(a), "التفعيلُ بلا dedupKey");
  });

  test("طابورُ البثّ يُمحى بعد ٢٠ ساعة لا ٤٨ (طلبُ محمد)", () => {
    const q = code("src/lib/broadcastQueue.ts");
    assert.ok(/const EXPIRE_H = 20;/.test(q), "مهلةُ الطابور ليست ٢٠ ساعة");
  });

  test("العزل: فحصُ alreadySentToday يُرشّح بالمشترك وبالوكيل وبالقناة", () => {
    const d = code("src/lib/messageDedup.ts");
    assert.ok(/subscriberId,/.test(d) && /channel: "WHATSAPP"/.test(d), "الفحصُ لا يعزل بالقناة/المشترك");
    assert.ok(/agentId != null \? \{ agentId \}/.test(d), "الفحصُ لا يؤكّد العزلَ بالوكيل");
  });
});
