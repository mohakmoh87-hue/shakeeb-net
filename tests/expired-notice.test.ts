import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ البند ٤-أ · «المنتهون منذ N يوم» — رسالةٌ واحدةٌ لكلّ انتهاء ═════
//
// طلبُ محمد: «أختار بعد كم يومٍ من الانتهاء تُرسَل ووقتَ الإرسال، وقالبٌ خاصٌّ بهم.
// **ومَن أُرسل له وهو منتهٍ منذ يوم لا يُرسَل له غداً** وهو منتهٍ منذ يومَين.»
//
// وهذه ميزةٌ **تُرسل رسائلَ إلى مشتركين حقيقيّين**، فأخطرُ ما فيها ليس ألّا تعمل بل أن
// تعمل أكثرَ من اللازم. وثلاثةُ أخطارٍ يحرسها هذا الملفّ:
//   ١. **الرشقةُ الأولى**: الاختيارُ على «ختمٌ فارغ»، والختمُ فارغٌ عند كلّ مشتركٍ لحظةَ
//      إضافة العمود ⇒ أوّلُ تشغيلٍ يُرسل لكلّ منتهٍ في تاريخ المكتب. (والردمُ قِيس:
//      **١٣٧٠٨ مشتركاً** خُتموا «أُبلِغوا سلفاً» — هذا حجمُ الرشقة التي مُنعت.)
//   ٢. **التكرار**: حاسبتان تعملان معاً ⇒ نسختان لكلّ مشترك (حادثةُ الشدن: ٤ نسخ).
//   ٣. **الصمتُ الأبديّ**: ختمٌ لا يُمسَح عند التفعيل يمنع رسالةَ الانتهاء القادم للأبد.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SCHED = () => read("src/lib/scheduler.ts");
const fnBody = (src: string, name: string): string => {
  const i = src.indexOf(`export async function ${name}`);
  assert.ok(i > -1, `الدالّةُ غائبة: ${name}`);
  const rest = src.slice(i);
  const end = rest.indexOf("\n}\n");
  return rest.slice(0, end > -1 ? end : rest.length);
};

describe("البند ٤-أ · المنتهون منذ N يوم", () => {
  test("🛡️ الختمُ **قبل** الإرسال وبشرطِ أنّه فارغ — فلا نسختان", () => {
    const body = fnBody(SCHED(), "runExpiredNotice");
    const claimAt = body.indexOf("expiredNoticeAt: new Date()");
    const sendAt = body.indexOf("sendViaProvider");
    assert.ok(claimAt > -1, "لا ختمَ إطلاقاً");
    assert.ok(sendAt > -1, "لا إرسال؟");
    assert.ok(claimAt < sendAt, "🔴 الختمُ **بعد** الإرسال ⇒ حاسبتان تُرسلان مرّتَين (درسُ الشدن)");
    // والشرطُ هو الذرّيّة: `updateMany` بشرط `null` — ومَن خسر السباقَ يجد count=0
    assert.match(body, /where: \{ id: sub\.id, expiredNoticeAt: null \}/, "الختمُ بلا شرطِ الفراغ ⇒ ليس ذرّيّاً");
    assert.match(body, /if \(claim\.count !== 1\) continue/, "الخاسرُ في السباق لا يتخطّى ⇒ يُرسل نسخةً ثانية");
  });

  test("🛡️ حَجزُ يومِ المكتب قبل أوّل رسالة — كبقيّة المُجدولات", () => {
    const body = fnBody(SCHED(), "runExpiredNotice");
    assert.match(body, /lastExpiredNoticeDate/, "لا حَجزَ ليوم المكتب");
    const claim = body.indexOf("lastExpiredNoticeDate: todayK");
    assert.ok(claim > -1 && claim < body.indexOf("sendViaProvider"), "حَجزُ اليوم بعد الإرسال");
  });

  test("🛡️ نافذةٌ عُلويّةٌ للانتهاء — لا رسالةَ لمنتهٍ قديم", () => {
    // بلا حدٍّ أعلى يصير كلُّ منتهٍ ختمُه فارغٌ هدفاً — وهي الرشقةُ التي مُنعت بالردم،
    // وهذا حرسٌ **ثانٍ** لو أُضيف عمودٌ من جديدٍ أو أُفرِغ ختمٌ بالخطأ.
    const src = SCHED();
    assert.match(src, /EXPIRED_NOTICE_GRACE_DAYS/, "لا نافذةَ عُلويّة");
    const body = fnBody(src, "runExpiredNotice");
    assert.match(body, /dateTo: \{ lte: upper, gte: lower \}/, "الاختيارُ بلا حدٍّ أدنى للتاريخ ⇒ كلُّ منتهٍ قديمٍ هدف");
  });

  test("🛡️ الختمُ يُمسَح عند التفعيل — من البرنامج ومن الساس معاً", () => {
    // مسارُ التفعيل في البرنامج
    assert.match(read("src/app/api/subscribers/[id]/activate/route.ts"), /expiredNoticeAt: null/,
      "التفعيلُ لا يمسح الختمَ ⇒ لا رسالةَ في انتهائه القادم أبداً");
    // ومسارُ المزامنة (المشتركُ فعّل بنفسه من تطبيق سوبر سيل ⇒ التاريخُ يتقدّم هنا)
    assert.match(read("src/lib/subscriptionSync.ts"), /data: \{ dateTo: validDate, expiredNoticeAt: null \}/,
      "تمديدُ التاريخ بالمزامنة لا يمسح الختم");
  });

  test("كلُّ مكتبٍ بأيّامه ووقته — ولا يُجمَعون في استعلامٍ واحد", () => {
    const body = fnBody(SCHED(), "runExpiredNotice");
    // مكتبٌ يختار يوماً وآخرُ ثلاثةً: نافذةُ كلٍّ تُحسَب بأيّامه
    assert.match(body, /for \(const office of offices\)/, "لا معالجةَ لكلّ مكتبٍ على حِدة");
    assert.match(body, /office\.expiredNoticeDays \?\? 1/, "أيّامُ المكتب غيرُ مقروءة (أو بلا افتراض)");
    // والوقتُ: خاصُّ المكتب ← وقتُ تذكير الانتهاء ← وقتُ الوكيل
    assert.match(SCHED(), /o\.expiredNoticeTime\?\.trim\(\) \|\| o\.reminderTime\?\.trim\(\) \|\| reminderTime/, "سلَّمُ الوقت ناقص");
  });

  test("مُطفأةٌ افتراضاً — لا تُشتغل على مكتبٍ لم يطلبها", () => {
    // ميزةٌ تُرسل رسائلَ لا تُفعَّل ضمناً: `expiredNoticeEnabled === "1"` صريحاً
    assert.match(SCHED(), /expiredNoticeEnabled: "1"/, "الاختيارُ غيرُ مشروطٍ بتفعيلٍ صريح");
    // والواجهةُ تُظهر الحقول عند التفعيل فقط
    const page = read("src/app/(app)/towers/page.tsx");
    assert.match(page, /form\.expiredNoticeEnabled === "1" && \(/, "الحقولُ تظهر بلا تفعيل");
    // والمسارُ يقبلها ويحدّ أيّامها
    for (const f of ["src/app/api/towers/[id]/route.ts", "src/app/api/towers/route.ts"]) {
      assert.match(read(f), /expiredNoticeDays: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(60\)/, `${f}: الأيّامُ بلا حدود`);
    }
  });

  test("العزلُ وقالبٌ مُعطَّلٌ يمنع الإرسالَ **والختمَ** معاً", () => {
    const sched = SCHED();
    // عزل: مكاتبُ وكيل هذا العامل حصراً (كبقيّة المُجدولات)
    assert.match(sched, /expiredNoticeEnabled: "1"[\s\S]{0,160}wAgent != null \? \{ agentId: wAgent \}/, "بلا عزلِ وكيل");
    const body = fnBody(sched, "runExpiredNotice");
    // 🔑 والقالبُ يُقرأ **قبل** الحلقة: لو خُتم مشتركٌ ثمّ وُجد القالبُ معطَّلاً لَخُتم
    //   بلا رسالة — فيُحرَم رسالتَه هذه ولا يُعاد المحاولةُ (الختمُ باقٍ).
    const tplAt = body.indexOf(`getTemplate("expiredSince"`);
    const stampAt = body.indexOf("expiredNoticeAt: new Date()");
    assert.ok(tplAt > -1 && tplAt < stampAt, "القالبُ يُقرأ بعد الختم ⇒ ختمٌ بلا رسالة");
    assert.match(body, /if \(!tpl\) continue;/, "قالبٌ معطَّلٌ لا يمنع الختم");
  });
});
