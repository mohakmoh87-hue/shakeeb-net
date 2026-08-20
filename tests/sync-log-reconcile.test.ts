import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ ♻️🔍 دفعةُ 2026-08-21: ستّةُ أعطالٍ مقيسةٍ على بيانات محمد الحيّة + سجلٌّ تفاعليّ ═════
//
// كلُّ تأكيدٍ هنا يحرس عطلاً **قِيس** لا يُفترَض:
//   ١ تبويب التنصيبات كان كلُّه كاذباً لأنّ سوبر سيل تسمّي باقاتِها «Offer-…».
//   ٢ «تفعيل خارجي» كان لا ينظر إلى الوصولات إطلاقاً (bg-13-13-7@mu: تفعيلة ١٦:١٩ ووصل ٢٠:٤٧).
//   ٣ المزامنة لا تقارن **اليوزر** — فتغيّرُه في الساس يبقى خفيّاً (bg-7-4-2@mu ← bg-7-5-1@mu).
//   ٤ الجردُ الشاملُ للكروت كان بمُستدعٍ واحد: المزامنةُ اليدويّة.
//   ٥ عناصرُ التطبيق تظهر في المتصفّح (تصادُمُ أولويّةٍ في CSS).
//   ٦ السجلُّ لم يكن يُغلق ما عولج — وشرطُ محمد أن «يحدّث نفسه مع المزامنة التالية».

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SYNC = () => read("src/lib/subscriptionSync.ts");

describe("♻️ سجلّ المزامنة التفاعليّ ودفعةُ الأعطال الستّة", () => {
  test("١ · قاعدةُ «باقة العرض = تنصيب» أُلغيت — لا يُرمى مشتركٌ عاديٌّ في التبويب", () => {
    const src = SYNC();
    assert.equal(/isOfferPackage\(/.test(src), false, "قاعدةُ Offer ما زالت تُستعمل — وهي تُطابق باقاتِ سوبر سيل العاديّة");
    // ولا يبقى نداءُ تنصيبٍ لمشتركٍ قائمٍ إلّا في حالة «اليوزر المعاد» (subscriberId: oldByUser.id)
    const installs = src.match(/recordInstall\(\{[\s\S]{0,140}subscriberId: [^,\n]+/g) ?? [];
    for (const m of installs) {
      assert.ok(/subscriberId: (null|oldByUser\.id)/.test(m), `نداءُ تنصيبٍ بمشتركٍ قائمٍ غيرِ حالة اليوزر المعاد: ${m.slice(0, 80)}`);
    }
  });

  test("٢ · الوصلُ يُغلق «تفعيل خارجي» كما يُغلق «تفعيلات ساس» — فحصٌ واحدٌ للنوعَين", () => {
    const src = SYNC();
    assert.match(src, /const kind: "sas" \| "self" \| null = managerMatch \? "sas" : \(isCabinetManager/,
      "التصنيفُ لم يُوحَّد — «تفعيل خارجي» قد يعود بلا فحص وصل");
    assert.match(src, /if \(!receipt\) await recordActivationEvent\(kind, evBase\);/, "الحدثُ يُسجَّل بلا فحص وصلٍ للنوعَين");
    // والإغلاقُ اللاحق (وصلٌ سُجّل بعد الرصد) يشمل النوعَين
    assert.match(read("src/lib/syncLog.ts"), /kind: \{ in: \["sas", "self"\] \}, status: "pending"/,
      "resolveEventIfReceipted ما زال محصوراً بتفعيلات الساس");
  });

  test("٣ · تغيّرُ اليوزر يُرصَد أوّلاً وبالأحمر، ويُطبَّق إعادةَ تسميةٍ بحارس تكرار", () => {
    const src = SYNC();
    assert.match(src, /netUser: true/, "يوزرُ صفّنا لا يُجلَب أصلاً فلا يمكن مقارنتُه");
    assert.match(src, /f: "netUser", label: "🔴 اليوزر تغيّر في الساس"/, "لا رصدَ لتغيّر اليوزر");
    // التطبيقُ إعادةُ تسميةٍ لا إنشاءَ صفٍّ — وبحارسٍ يمنع تصادمَ يوزرَين
    const api = read("src/app/api/sync-log/route.ts");
    assert.match(api, /netUser: renameTo/, "التحديثُ لا يُصحّح اليوزر");
    assert.match(api, /اليوزر الجديد يخصّ مشتركاً آخرَ/, "إعادةُ التسمية بلا حارس تكرار");
    assert.match(api, /SYNC_LOG_RENAME_USER/, "تصحيحُ اليوزر بلا أثرِ تدقيق");
    // والواجهةُ تعرضه أحمرَ (شرط محمد الحرفيّ)
    assert.match(read("src/components/SyncLogModal.tsx"), /c\.f === "netUser" \?[\s\S]{0,200}border-red-300/, "تغيّرُ اليوزر لا يظهر بالأحمر");
  });

  test("٤ · الكروت: جردٌ ليليٌّ تلقائيّ · وكارتُ اليوزر المجهول يُعلَّم · والربطُ باليوزر أوّلاً", () => {
    // (أ) الجردُ الشاملُ لم يعد حكراً على المزامنة اليدويّة
    assert.match(read("src/lib/internalCron.ts"), /runFullCardAudit\(o\.id\)/, "الجردُ الشاملُ لا يعمل ليلاً — يبقى بمُستدعٍ يدويٍّ واحد");
    const src = SYNC();
    // (ب) تفعيلةٌ ليوزرٍ غير مستوردٍ لم تعد تقفز فوق الكارت
    assert.match(src, /كارتٌ استُهلك ليوزرٍ غير مستوردٍ بعد — عُلّم مستخدماً/, "الكارتُ يبقى «متاحاً» حين يكون صاحبُه غيرَ مستورد");
    // (ج) الربطُ باليوزر قبل الرقم (الرقمُ قد يكون مغلوطاً — حالة bg-7-4-2)
    assert.match(src, /const sub = \(hitUser \? subsByUser\.get\(hitUser\) : null\)/, "الجردُ يربط بالرقم وحدَه — والرقمُ قد يكذب");
  });

  test("٥ · عناصرُ التطبيق مقفولةٌ خارجَه بأولويّةٍ تغلب الأساس", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /html:not\(\[data-app-trial\]\) \.trial-more,/, "قفلُ عناصر التطبيق غائب");
    assert.match(css, /html:not\(\[data-app-trial\]\) \.trial-only-chip \{ display: none !important; \}/, "شارةُ اليوزر ما زالت تُسرَّب للمتصفّح");
    // والعنوانُ خرج من قائمة آخر التفعيلات
    assert.equal(/sb-chip" title="العنوان/.test(read("src/components/SubscribersBoard.tsx")), false, "شارةُ العنوان ما زالت في قائمة آخر التفعيلات");
  });

  test("٦ · السجلُّ يُصحّح نفسَه — ولا يُغلق ما لم يره", () => {
    const lib = read("src/lib/syncLog.ts");
    assert.match(lib, /export async function reconcileInstalls/, "لا تصحيحَ ذاتيّاً للتنصيبات");
    assert.match(lib, /export async function reconcileInfo/, "لا تصحيحَ ذاتيّاً للمعلومات");
    // 🔒 الشرطُ الحاسم: لا إغلاقَ بالظنّ — مسحٌ فاشلٌ لا يمحو سجلّاً
    assert.equal((lib.match(/if \(!seenSasIds\.size\) return 0;/g) ?? []).length, 2, "قد يُغلق السجلُّ صفوفاً لم تُرَ في هذه الدورة");
    const src = SYNC();
    assert.match(src, /const closedInstalls = await reconcileInstalls\(officeId, seenSasIds, stillInstalls\)/, "التصحيحُ لا يُنادى من المزامنة");
    assert.match(src, /seenSasIds\.add\(u\.sasId\)/, "لا تُجمَع الحالاتُ المرئيّة");
    assert.match(src, /stillInstalls\.add\(u\.sasId\)/, "لا يُميَّز التنصيبُ الباقي عن المُعالَج");
  });
});
