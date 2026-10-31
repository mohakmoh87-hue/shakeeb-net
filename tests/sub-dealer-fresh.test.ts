import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ═════ 🕵️ «الجددُ وحدَهم» — حرّاسُ مطابقةِ الإشعار لِما تعرضه اللوحة ═════
// كان الكرونُ يحسب الجددَ (مقارنةً بالفحص التلقائيِّ الذي قبله) ويكتب عددَهم في الإشعار
// ثمّ **يرميه**، والرابطُ بلا معرّفِ فحص — فلا سبيلَ لمراجعة الستّةِ الجدد بين مئتَين.
// الآن يُشتقّ «الجدد» في GET بنفس التعريف حرفيّاً، فأيُّ انحرافٍ بين الرقمَين كذبٌ على محمد.
describe("sub-dealer: الجدد", () => {
  const cron = read("src/lib/internalCron.ts");
  const route = read("src/app/api/manager/sub-dealer-check/route.ts");

  test("رابطُ الإشعار يحمل معرّفَ الفحص وعلَمَ الجدد", () => {
    assert.ok(/sec=subdealer&scan=\$\{res\.scanId\}&new=1/.test(cron), "الرابطُ بلا scan ⇒ يفتح أحدثَ ليلةٍ لا ليلةَ الإشعار");
    assert.ok(/subdealer&new=1/.test(cron), "ارتدادُ «بلا معرّف» مفقود");
  });

  test("الكرونُ واللوحةُ يفتحان الجددَ بنفس المفتاح: يوزرُ المشتبَه", () => {
    assert.ok(/suspect\?\.username/.test(cron), "مفتاحُ الكرون تغيّر");
    assert.ok(/c\?\.suspect\?\.username/.test(route), "مفتاحُ اللوحة تغيّر — لا يطابق الكرون");
    assert.ok(/trim\(\)\.toLowerCase\(\)/.test(route), "بلا تطبيعٍ ⇒ فرقُ حالةِ الأحرف يصنع «جديداً» كاذباً");
  });

  test("المقارنةُ بالفحص الذي قبله مباشرةً لا بأحدث فحص", () => {
    assert.ok(/createdAt: \{ lt: lastAutoRow\.createdAt \}/.test(route), "المقارنةُ بغير الفحص السابق تُفسد تعريفَ «جديد»");
    assert.ok(/prevAt:/.test(route), "تاريخُ الفحص المُقارَن به لا يُرسَل ⇒ «جديد» بلا مرجعٍ ظاهر");
  });

  // 🔒 عزل: معرّفُ الفحص يأتي من الرابط — فلو قُرئ بلا agentId رأى وكيلٌ مشتبَهي وكيلٍ آخر
  test("الفحصُ المطلوب بالرابط محروسٌ بالوكيل والمصدر", () => {
    assert.ok(
      /id: wantScan, agentId: gr\.agentId, source: "auto"/.test(route),
      "قراءةُ فحصٍ بمعرّفٍ من العميل بلا agentId = خرقُ عزل",
    );
  });

  test("قائمةُ الليالي ترويساتٌ فقط — لا تُجلب JSON المشتبَهين", () => {
    const m = route.match(/const nights = await prisma\.subDealerScan\.findMany\(\{[\s\S]*?\}\);/);
    assert.ok(m, "استعلامُ الليالي غير موجود");
    assert.ok(!/suspects: true/.test(m![0]), "جلبُ suspects لعشرين ليلةً يثقّل الردَّ بلا داعٍ");
    assert.ok(/take: 20/.test(m![0]), "حدُّ الليالي ساقط");
  });
});
