import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🛡️ حارسُ «اليوزر المختلف» (طلب محمد 2026-08-21 — حالة bg-7-4-2@mu الحيّة) ═════
//
// صفحةُ تفعيل الساس تُفتح **بالرقم** (sasId) — فرقمٌ معكوسٌ يفتح يوزراً آخرَ والمالُ
// يذهب لحسابِ غير صاحبه. نصُّه: «الحارس هو لليوزر تحديداً وليس شيء آخر لان كل شيء
// غير مهم عدا اليوزر الثابت» — لا تفعيلَ ولا سحبَ كارتٍ قبل صحِّ الإقرار وضغطِ موافق.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("🛡️ حارسُ اليوزر المختلف عند التفعيل", () => {
  test("🔒 الخادمُ يحكم لا الواجهة: التفعيلُ يُرفَض 409 عند اختلافٍ مُثبَتٍ بلا إقرار", () => {
    const api = read("src/app/api/subscribers/[id]/activate/route.ts");
    // المقارنةُ ليوزرِ صاحبِ الرقم في الساس — مقصوصةً بحروفٍ صغيرة (اليوزرُ هو الفيصل)
    assert.match(api, /sasUser\.toLowerCase\(\) !== subscriber\.netUser!\.trim\(\)\.toLowerCase\(\)/, "لا مقارنةَ يوزرٍ في الخادم");
    assert.match(api, /userMismatch: true/, "الرفضُ بلا رايةٍ تُميّزه للواجهة");
    assert.match(api, /status: 409/, "الاختلافُ لا يُرفَض برمزٍ صريح");
    assert.match(api, /confirmUserMismatch/, "لا بابَ إقرارٍ صريح");
    // والإقرارُ يُوثَّق أثراً — فذهابُ مالٍ ليوزرٍ مختلفٍ يجب أن يبقى مقروءاً للتدقيق
    assert.match(api, /ACTIVATE_USER_MISMATCH_CONFIRMED/, "إقرارُ الاختلاف بلا أثرِ تدقيق");
    // وتعذُّرُ القراءة لا يحجب (لا يُعطَّل مكتبٌ كاملٌ لعطلِ اتصالٍ عابر)
    assert.match(api, /تعذّرت القراءة — لا حجبَ/, "فشلُ الاتصال بالساس يحجب التفعيل — وهو قرارٌ خاطئ");
  });

  test("النافذةُ تحجب سحبَ الكارت والحفظَ معاً حتى صحِّ الإقرار", () => {
    const m = read("src/components/ActivationModal.tsx");
    assert.match(m, /const mismatchBlock = sasIdent\?\.checked === true && sasIdent\.match === false && !mismatchOk/,
      "لا حالةَ حجبٍ مشروطةً بالإقرار");
    // زرُّ سحب البطاقة وزرّا الحفظ الثلاثةُ كلُّهم خلف الحجب
    assert.match(m, /disabled=\{loadingCard \|\| !packageId \|\| mismatchBlock\}/, "سحبُ الكارت غيرُ محجوب");
    assert.equal((m.match(/disabled=\{saving \|\| mismatchBlock\}/g) ?? []).length, 2, "زرّا الحفظ غيرُ محجوبَين");
    assert.match(m, /if \(mismatchBlock\) \{ setError\(/, "confirm\\(\\) بلا صمّامٍ ثانٍ");
    // الإقرارُ يُمرَّر للخادم، وردُّ 409 الدفاعيُّ يُظهر الإنذارَ حتى لو فات فحصُ الفتح
    assert.match(m, /confirmUserMismatch: mismatchOk/, "الإقرارُ لا يصل الخادم");
    assert.match(m, /data\.userMismatch/, "ردُّ الخادم 409 لا يُلتقط دفاعيّاً");
    // والإنذارُ يعرض اليوزرَين صراحةً — فالقرارُ قرارُ عينٍ لا تخمين
    assert.match(m, /صفحةُ الساس مفتوحةٌ على يوزرٍ مختلف/, "لا إنذارَ مقروءاً");
  });

  test("هويّةُ الرقم تُقرأ من الساس (username مع sasFetchUser) ومسارُ الهويّة معزول", () => {
    assert.match(read("src/lib/sas4.ts"), /username: typeof u\.username === "string"/, "الساس لا يُسأل عن اليوزر");
    const ident = read("src/app/api/subscribers/[id]/sas-identity/route.ts");
    assert.match(ident, /guard\("subscriptions\.manage"\)/, "مسارُ الهويّة بلا صلاحيّة");
    assert.match(ident, /ownsTower/, "مسارُ الهويّة بلا عزلِ مكتب");
    assert.match(ident, /checked: false, match: true/, "تعذُّرُ الفحص لا يعود فتحاً آمناً (fail-open)");
  });
});
