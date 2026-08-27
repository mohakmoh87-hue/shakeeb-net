import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// ═════ 👁️ قالب «انتهى الاشتراك» يُرى ويُعدَّل (بلاغ محمد 2026-08-27) ═════
//
// «لما لا أستطيع رؤيته عند صميم وماذا عن بقية المكاتب؟» — كان النوعُ `expiredSince`
// موجوداً في قائمة الخادم (EVENT_TYPES في smsTemplates.ts) ويُرسِل بنصّه الافتراضيّ،
// لكنّه غائبٌ عن قائمة EVENTS في صفحة القوالب ⇒ **محجوبٌ عن كلّ الوكلاء بلا استثناء**:
// لا نصَّ يُقرأ ولا تعديلَ ولا صورةَ ولا مفتاحَ تعطيلِ نصٍّ. ومسارُ bulk كان جاهزاً سلفاً
// (يبني الردَّ من قائمة الخادم ويدمج الافتراضيّ) — فالإصلاحُ سطرُ العرض وحدَه.

const ROOT = process.cwd();

describe("👁️ قالب «انتهى الاشتراك» ظاهرٌ في صفحة القوالب", () => {
  test("النوع في قائمة الصفحة وقائمة الخادم معاً — ولا يظهر قالباً حرّاً غريباً", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/app/(app)/sms-templates/page.tsx"), "utf8");
    const lib = fs.readFileSync(path.join(ROOT, "src/lib/smsTemplates.ts"), "utf8");
    // في قائمة الخادم (المُرسِل والزرع والافتراضيّ)
    assert.ok(lib.includes('"expiredSince"'), "النوع سقط من قائمة الخادم — المُرسِل المجدول سيصمت");
    assert.ok(/expiredSince: `/.test(lib), "النصُّ الافتراضيُّ ضاع — مكتبٌ بلا نصٍّ محفوظٍ لن يُرسل شيئاً");
    // وفي قائمة الصفحة (العرض والتعديل) — واشتقاقُ EVENT_TYPES منها يمنع ظهورَه «قالباً حرّاً» باسمٍ أعجميّ
    assert.ok(page.includes('{ type: "expiredSince", name: "انتهى الاشتراك"'),
      "النوع غائبٌ عن قائمة صفحة القوالب — يعود محجوباً عن كلّ الوكلاء");
    assert.ok(page.includes("const EVENT_TYPES = EVENTS.map((e) => e.type);"),
      "قائمةُ الأنواع لم تعد مشتقّةً من قائمة العرض — قد يظهر النوعُ قالباً حرّاً مكرَّراً");
    // ومسار bulk يبني من قائمة الخادم ويدمج الافتراضيّ — فالصفحة تستلم النصّ جاهزاً
    const bulk = fs.readFileSync(path.join(ROOT, "src/app/api/sms-templates/bulk/route.ts"), "utf8");
    assert.ok(bulk.includes("const result = EVENT_TYPES.map((cat) => {"), "مسارُ bulk لم يعد يبني من قائمة الخادم");
    assert.ok(bulk.includes("a?.text ?? DEFAULT_TEMPLATES[cat] ?? \"\""), "النصُّ الافتراضيُّ لا يصل الصفحةَ عند غياب صفٍّ محفوظ");
  });
});
