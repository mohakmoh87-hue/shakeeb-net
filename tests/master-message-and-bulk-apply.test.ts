import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ بلاغا محمد 2026-08-24 — حارسان ═════
//
// ① **رسالةُ الماستر تكذب**: «تفعيلٌ بماستر — المالُ يُسجَّل صحيحاً ولا دَينَ عليه، لكنّ
//    رسالةَ الواتساب تقول إنّ عليه دَيناً بقيمة الاشتراك». وسببُه أنّ الرسالةَ تُبنى
//    بـ`paid` (النقديُّ الخام = صفرٌ في الماستر الكامل) بينما الوصلُ والدَّينُ يُبنيان
//    بـ`effPaid`. ⇒ يجب أن تأخذ الرسالةُ **الواصلَ الفعليّ** كما يأخذه الوصل.
//
// ② **لا تحديثَ جماعيّاً إلّا في تبويبٍ واحد**: «عند تحديد الكلّ يوجد إرسالُ رسالةٍ لهم
//    لكن لا يوجد تحديثٌ لهم، فقط التحديثُ مشتركاً مشتركاً». والخادمُ يقبل القائمةَ أصلاً.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ACT = () => read("src/app/api/subscribers/[id]/activate/route.ts");
const MODAL = () => read("src/components/SyncLogModal.tsx");

describe("💳 رسالةُ التفعيل تقول الواصلَ الفعليّ", () => {
  test("① الرسالةُ تأخذ effPaid لا paid — وإلّا كذبت على مشترك الماستر", () => {
    const src = ACT();
    // نداءُ الرسالة وحدَه (لا بقيّةُ المسار) — ونهايتُه تُبحَث **بعد** بدايته
    const start = src.indexOf("sendActivationMessage({");
    const call = src.slice(start, src.indexOf("});", start));
    assert.ok(call.length > 100, "نداءُ رسالة التفعيل لم يُعثر عليه");
    assert.match(call, /paid: effPaid/, "الرسالةُ تُبنى بالنقديّ الخام ⇒ مشتركُ الماستر يُخبَر بدَينٍ لا وجودَ له");
    assert.match(call, /remaining: Math\.max\(0, grandTotal - effPaid\)/, "«المتبقّي» يُحسب من النقديّ لا من الواصل الفعليّ");
    assert.equal(/\n\s+paid,\n/.test(call), false, "ما زال يُمرَّر `paid` الخام");
  });

  test("🔒 والحسابُ الماليُّ لم يُمَسّ — الوصلُ والدَّينُ كما هما", () => {
    const src = ACT();
    assert.match(src, /const effPaid = fullPaid \? grandTotal : paid;/, "تعريفُ الواصل الفعليّ تغيّر");
    assert.match(src, /carry: \{ increment: fullPaid \? 0 : grandTotal - paid \}/, "حسابُ الدَّين تغيّر — وهو سليمٌ ولا يُمَسّ");
    assert.match(src, /money: total, moneyIn: effPaid/, "الوصلُ لم يعد يُخزَّن بالواصل الفعليّ");
  });
});

describe("📋 التحديثُ الجماعيُّ في التبويبات الأربعة", () => {
  test("② زرّا «تحديث/تجاهل المحدَّد» لا يُقصَران على تبويبٍ واحد", () => {
    const m = MODAL();
    assert.equal(/tab === "info" && \(\s*<>/.test(m), false,
      "أزرارُ الجماعة عادت محصورةً بتبويب «تحديث معلومات» — والبقيّةُ بلا تحديثٍ جماعيّ");
    // الزرّان موجودان ويناديان مسارَ الجماعة نفسَه الذي يناديه الزرُّ الفرديّ
    assert.match(m, /act\(\[\.\.\.sel\], "apply"\)/, "زرُّ التحديث الجماعيّ غائب");
    assert.match(m, /act\(\[\.\.\.sel\], "ignore"\)/, "زرُّ التجاهل الجماعيّ غائب");
    // وزرُّ الرسالة يبقى في تبويبَيه كما كان
    assert.match(m, /\(tab === "install" \|\| tab === "self"\)/, "زرُّ الإرسال فقد شرطَ تبويبَيه");
  });

  test("🔒 وحرّاسُ الخادم كما هي — التحديثُ الجماعيُّ يمرّ بها صفّاً صفّاً", () => {
    const api = read("src/app/api/sync-log/route.ts");
    assert.match(api, /const isEventRow = r\.kind === "self" \|\| r\.kind === "sas"/, "تمييزُ صفّ الحدث تغيّر");
    assert.match(api, /if \(loan\) outcome = "صاحبُ قرضٍ — أيّامه لم تُمَسّ"/, "حارسُ صاحب القرض سقط");
    assert.match(api, /r\.sasDateTo <= sub\.dateTo\) outcome = `تاريخُك أبعدُ/, "حارسُ «لا يُقصَّر تاريخٌ» سقط");
    assert.match(api, /const isLoanRow = \(r\.note \?\? ""\)\.startsWith\("💸 قرض"\)/, "حارسُ صفّ القرض سقط");
    // 🔒 ولا يُلمَس الخادمُ لهذا البلاغ: الجماعةُ مدعومةٌ أصلاً
    assert.match(api, /guard\("syncLog\.update"\)/, "مسارُ سجلّ المزامنة بلا صلاحيّة");
  });
});
