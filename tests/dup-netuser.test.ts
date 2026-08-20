import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ البند ٥ · «اليوزرُ هو الفيصلُ الأكبرُ الذي لا يُخطئ» (نصُّ محمد) ═════
//
// 🎯 وقِيس على الإنتاج 2026-08-14: **٥٢ يوزراً مكرَّراً** في مكاتبَ لخمسة وكلاء
//   (شكيب · جاكوار · saif …)، والفهرسُ `subscribers_towerId_netUser_idx` **غيرُ فريد**
//   فلا شيءَ يمنع المزيد.
//
// والسببُ مقيسٌ في الشيفرة: استيرادُ المرحلة الثانية يُطابق بـ`sasId` **وحدَه**. فمشتركٌ
// أعادت الشركةُ تنصيبَه فتغيّر `sasId` **ويوزرُه هو نفسُه** يُستورَد **صفّاً ثانياً**.
//
// 🔑 والمزامنةُ **تتوقّف عن الإفساد ولا تخترع حكماً**: لا تُنشئ صفّاً ليوزرٍ موجود، وتُبلّغ
//   بالعدد ليقرّر محمد (استبدالٌ كامل؟ دمج؟) — فالقرارُ في المال والدَّين ليس قرارَ سكربت.

const ROOT = process.cwd();
const SRC = () => fs.readFileSync(path.join(ROOT, "src/lib/subscriptionSync.ts"), "utf8");

describe("البند ٥ · لا يُستورَد يوزرٌ موجودٌ سلفاً", () => {
  test("🛡️ الحرسُ **قبل** الرصد لا بعده", () => {
    // (منذ سجلّ المزامنة 2026-08-20: «الإنشاء» صار «رصداً» recordInstall — والحرسُ باقٍ
    //  قبله كي لا يظهر يوزرٌ مكرَّرٌ في تبويب «تنصيب خارجي» فيستورده صاحبُ الصلاحيّة صفّاً ثانياً)
    const src = SRC();
    const guardAt = src.indexOf("progByUser.has(uKey)");
    assert.ok(guardAt > -1, "لا حرسَ على تكرار اليوزر");
    const recordAt = src.indexOf("recordInstall({", guardAt);
    assert.ok(recordAt > -1 && guardAt < recordAt, "الحرسُ بعد الرصد ⇒ لا يمنع شيئاً");
    assert.match(src, /if \(uKey && progByUser\.has\(uKey\)\) \{\s*\r?\n\s*dupUserSkipped\+\+;\s*\r?\n\s*continue;/,
      "الحرسُ لا يتخطّى الصفَّ فعلاً");
  });

  test("المطابقةُ **بحرفٍ صغيرٍ ومقصوص** — فاليوزرُ نفسُه بحالةِ أحرفٍ مختلفةٍ ليس جديداً", () => {
    const src = SRC();
    assert.match(src, /const uKey = \(u\.username \?\? ""\)\.trim\(\)\.toLowerCase\(\)/, "المطابقةُ حسّاسةٌ للحالة أو للفراغ");
    assert.match(src, /\(s\.netUser \?\? ""\)\.trim\(\)\.toLowerCase\(\)/, "بناءُ الخريطة لا يُطبّع اليوزر");
  });

  test("🛡️ الخريطةُ تشمل **كلَّ** مشتركي المكتب لا أصحابَ `sasId` وحدَهم", () => {
    const src = SRC();
    // خريطةُ `sasId` مقصورةٌ على `sasId: { not: null }` — ولو بُنيت خريطةُ اليوزر بنفس
    // الشرط لَمرّ يوزرٌ موجودٌ بصفٍّ بلا `sasId` فتكرّر. والفرقُ صامتٌ لا يُخطئ.
    const i = src.indexOf("progByUser");
    const q = src.slice(i, i + 700);
    assert.match(q, /netUser: \{ not: null \}/, "الخريطةُ لا تُقيَّد بمن له يوزر");
    assert.equal(/sasId: \{ not: null \}[\s\S]{0,120}netUser: \{ not: null \}/.test(q), false,
      "خريطةُ اليوزر مقصورةٌ على أصحاب sasId ⇒ يمرّ المكرَّرُ من صفٍّ بلا sasId");
  });

  test("🔴 لا إعلانَ مُظلِّلٌ للعدّاد — وإلّا ضاع العدُّ صامتاً", () => {
    // كتبتُ الإعلانَ أوّلاً **داخل** `try` مع إعلانٍ خارجيٍّ ⇒ الداخليُّ يُظلّل الخارجيَّ،
    // فيُعَدُّ التكرارُ ويبقى المُبلَّغُ صفراً. أمسكه `tsc` بالمصادفة لا بالتصميم.
    const src = SRC();
    assert.equal((src.match(/let dupUserSkipped = 0;/g) ?? []).length, 1,
      "إعلانان للعدّاد ⇒ الداخليُّ يُظلّل الخارجيَّ فيضيع العدّ");
  });

  test("لا يُسكَت عن الحالة: تُبلَّغ في النتيجة وفي تقرير الواتساب", () => {
    const src = SRC();
    assert.match(src, /dupUserSkipped\?: number/, "الحقلُ غائبٌ عن نوع النتيجة");
    assert.match(src, /phase2: \{[^}]*dupUserSkipped \}/, "العدّادُ لا يُعاد في النتيجة");
    assert.match(src, /يوزرٌ موجودٌ سلفاً فلم يُستورَد \(يحتاج قرارك\)/, "لا سطرَ في تقرير المدير");
  });

  test("وباقةُ العروض المجهولةُ لا تمنع الرصدَ ولا الاستيراد — والأيّامُ من الساس", () => {
    // طلبُ محمد (البند ٥ نقطة ١). منذ سجلّ المزامنة: الجديدُ **يُرصَد** بتاريخ الساس
    // كاملاً، والاستيرادُ الفعليُّ في مسار «حفظ» بالسجلّ — وكلاهما لا تمنعه باقةٌ مجهولة.
    const src = SRC();
    const guardAt = src.indexOf("progByUser.has(uKey)");
    const block = src.slice(src.indexOf("recordInstall({", guardAt), src.indexOf("recordInstall({", guardAt) + 400);
    assert.match(block, /sasDateTo: validDate/, "الجديدُ يُرصَد بلا تاريخ الساس");
    assert.match(block, /packageName: u\.packageName/, "الباقةُ لا تُرصَد مع التنصيب");
    // ومسارُ «حفظ» يستورد بتاريخ الساس ويطابق الباقةَ (والمجهولةُ تُترك فارغةً لا مانعةً)
    const api = fs.readFileSync(path.join(ROOT, "src/app/api/sync-log/route.ts"), "utf8");
    assert.match(api, /dateTo: r\.sasDateTo/, "الاستيرادُ من السجلّ بلا أيّام الساس");
    assert.match(api, /packageId: matcher\.match\(r\.packageName\)/, "الباقةُ لا تُطابَق عند الاستيراد من السجلّ");
    // والتخطّي (`skippedPkg`) باقٍ مشروطاً بوجود المشترك (`p`) — للقائم لا للجديد
    assert.match(src, /if \(\(u\.packageName \?\? ""\)\.trim\(\) && sasPkgId == null\) \{ skippedPkg\+\+; continue; \}/,
      "شرطُ تخطّي الباقة تغيّر — أعِد التحقّق أنّه لا يمسّ الرصدَ الجديد");
  });
});
