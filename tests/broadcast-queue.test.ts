import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ ب-٢ · الإرسالُ الجماعيُّ لا يُكمل أبداً — صار طابوراً في القاعدة يُستأنف ═══════
// بثُّ الشدن مات عند ٤١٦/٢٤٤٧: الحلقةُ كانت مفصولةً في ذاكرة الحاوية وأيُّ نشرةٍ تقتلها،
// والصفوفُ كانت تُكتب **بعد** كلّ محاولةٍ فلا أثرَ للبقيّة.
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const Q = "src/lib/broadcastQueue.ts";
const ROUTE = "src/app/api/messages/route.ts";

describe("ب-٢ · طابور البثّ الجماعيّ", () => {
  test("🔑 المستلمون يُكتبون صفوفاً PENDING **قبل** أيّ إرسال — فالمتبقّي محفوظٌ مهما حدث", () => {
    const src = read(ROUTE);
    // skipDuplicates أُضيف لحارس التكرار (2026-08-19) — الاصطفافُ المسبقُ قائمٌ كما هو
    assert.ok(/message\.createMany\(\{ data: rows, skipDuplicates: true \}\)/.test(src), "لا اصطفافَ مسبقاً — عادت حلقةُ الذاكرة");
    assert.ok(/kickBroadcastDrainer/.test(src), "المسارُ لا يركل الساحب");
  });

  test("🔒 الحَجزُ ذرّيٌّ بعبارةٍ واحدة (درسُ الشدن: لا استطلاعَ بلا حَجز)", () => {
    const src = read(Q);
    assert.ok(/FOR UPDATE SKIP LOCKED/.test(src), "حاويتان متراكبتان لحظةَ نشرٍ سترسلان الصفَّ مرّتَين");
    assert.ok(/UPDATE messages SET error = \$\{CLAIM_MARK\}/.test(src), "الحَجزُ ليس بعلامةٍ تُفحَص");
  });

  test("🛡️ درعُ المقصلة (حادثة ١٧٦ رسالة 2026-08-14): الطابورُ موسومٌ والمجدولُ يستثنيه", () => {
    // صفوفُ الطابور تُدرَج بعلامة QUEUE_MARK في error — ومقصلةُ «محاولة واحدة» على الحاسبات
    // كانت تُلغي كلَّ PENDING بلا استثناءٍ فذبحت بثَّ مكتب الرسالة في أوّل دقيقة.
    assert.ok(/QUEUE_MARK/.test(read(Q)), "لا علامةَ اصطفافٍ للصفوف");
    assert.ok(/error: QUEUE_MARK/.test(read(ROUTE)), "الإدراجُ بلا علامةٍ — المقصلةُ ستذبحه");
    const sched = read("src/lib/scheduler.ts");
    assert.ok(/status: "PENDING", error: null/.test(sched), "المقصلةُ ما زالت تحصد كلَّ PENDING — ستذبح الطابورَ ثانيةً");
    // والحالاتُ العابرة أثناء إعادة تشغيل الحاسبات («غير جاهز») انتظارٌ لا فشل
    assert.ok(/غير جاهز/.test(read(Q)), "«غير جاهز (الحالة: starting/qr)» يُختَم فشلاً — عينُ حادثة 18:32");
  });

  test("🖼️ صورةُ القالب ترافق البثَّ المصطفّ (templateType على الصفّ يقرؤه الساحب)", () => {
    const src = read(Q);
    assert.ok(/"templateType"/.test(src), "الحَجزُ لا يُرجع نوعَ القالب");
    assert.ok(/imageFor\(job\.templateType/.test(src), "الساحبُ لا يُحمّل صورةَ القالب");
    // «bulk» بدل null لحارس التكرار (2026-08-19) — القالبُ ما زال يُحفَظ على الصفّ
    assert.ok(/templateType: templateType \?\? "bulk"/.test(read(ROUTE)), "الإدراجُ لا يحفظ نوعَ القالب");
  });

  test("📴 حاسبةُ المكتب مطفأة ⇒ الصفُّ يبقى منتظراً لا فاشلاً — البثُّ يُستأنف حين تعود", () => {
    const src = read(Q);
    assert.ok(/غير مشغّلة\|غير متصل/.test(src), "غيابُ الناقل يُختَم فشلاً — فتضيع الرسالة");
    assert.ok(/releaseClaim/.test(src), "الحَجزُ لا يُفَكّ عند غياب الناقل");
    // ولا خلودَ: المنتظرُ فوق ٤٨ ساعةً يُختَم بسببٍ مقروء
    assert.ok(/EXPIRE_H/.test(src), "صفٌّ منتظرٌ يخلد للأبد");
  });

  test("🔁 الاستئنافُ عند إقلاع الموقع — وعلى الموقع حصراً لا حواسيب المكاتب", () => {
    const src = read("src/instrumentation.ts");
    assert.ok(/RUN_WORKER !== "1"/.test(src), "الساحبُ يعمل على حواسيب المكاتب أيضاً — تعدُّدُ سحّابين بلا داعٍ");
    assert.ok(/kick\("إقلاع الموقع"\)/.test(src), "لا استئنافَ بعد النشرة — عينُ موتِ بثّ الشدن");
    // ودوريّةُ كلّ ٥ دقائق: صفوفٌ أُعيدت يدويّاً للطابور تُلتقط بلا انتظار بثٍّ جديد
    assert.ok(/setInterval\(\(\) => void kick\("دوريّة"\)/.test(src), "لا دوريّةَ — الصفوفُ المُعادةُ يدويّاً تنام للأبد");
  });

  test("⏱️ فاصلُ مكافحة الحظر باقٍ — وصار **واحداً على الرقم** لا نسخةً لكلّ ساحب", () => {
    // 🚦 2026-08-25: انتقل الفاصلُ من ستّة مواضعَ متفرّقةٍ إلى بوّابة `waGate` عند نقطة
    //    الإرسال الوحيدة — فصار يشمل الطوابيرَ **والمسارات المباشرة** معاً (طلبُ محمد).
    //    وبقاؤه هنا أيضاً كان سيعني ضِعفَ الفاصل. وحراستُه في `tests/wa-gate.test.ts`.
    assert.ok(/sendWhatsApp\(towerId, job\.phone, job\.text, image, "bulk"\)/.test(read(Q)),
      "ساحبُ البثّ لم يعد يمرّ بالبوّابة بمسار الدفعات — خطرُ حظر الرقم");
    assert.ok(/isWaBusy\(outcome\.error\)/.test(read(Q)),
      "ازدحامُ الرقم يُختَم فشلاً بدل إعادة الصفّ إلى الطابور");
  });

  test("🚨 حادثةُ «أين ذهبت المهلة؟»: طابورُ الحاسبة لا يخطف طابورَ البثّ ولا يُرسل رشقةً", () => {
    // 2026-08-14: ١٧٦ رسالةً خرجت بمتوسّط ١٫١ث لأنّ `drainSelfActivatedQueue` على حاسبة
    // المكتب كانت تلتقط **كلَّ** PENDING بلا تمييزِ مصدرٍ وترسله بلا فاصل ⇒ خطرُ حظرِ الرقم.
    const s = read("src/lib/selfActivatedNotice.ts");
    assert.ok(/createdByUser: "sync"/.test(s), "طابورُ الحاسبة يلتقط صفوفاً ليست له — سيخطف البثَّ ثانيةً");
    // 🚦 الفاصلُ لم يعد هنا بل في بوّابة `waGate`، والعزلُ (createdByUser) يبقى حارساً
    //    مستقلّاً: البوّابةُ تمنع الرشقةَ، وهذا الشرطُ يمنع خطفَ صفوفِ طابورٍ آخرَ أصلاً.
    assert.ok(/queueImage, "bulk"\)/.test(s), "الطابورُ لا يمرّ بالبوّابة بمسار الدفعات — رشقةٌ تُعرّض الرقمَ للحظر");
    assert.ok(/draining\.has\(towerId\)/.test(s) && /draining\.delete\(towerId\)/.test(s),
      "بلا حارسِ تراكب — تُنادى كلَّ دقيقةٍ فتتوازى نسخُها ويعود التوازي من بابٍ آخر");
  });

  test("👤 الفرديُّ يبقى فوريّاً — المستخدمُ ينتظر نتيجتَه أمامه", () => {
    assert.ok(/target !== "one" && recipients\.length > 1/.test(read(ROUTE)), "الفرديُّ صار يصطفّ — فقدَ المستخدمُ نتيجتَه الفوريّة");
  });
});

// ═════ 🧹 عمرُ الطوابير ٢٤ ساعة (قرارُ محمد 2026-08-21 مساءً) ═════
// «كلُّ طابورٍ لا يُمسَح أبداً اجعله يُمسَح كلَّ ٢٤ ساعة، ولا تمسّ بقيّةَ الطوابير».
// وكان طابورا **البثّ** و**سجلّ المزامنة** بلا عمرٍ إطلاقاً: البثُّ لا مُنظِّفَ له، وطابورُ
// سجلّ المزامنة بُني «لا يُمسَح أبداً» بطلبٍ سابقٍ ثمّ صحّحه محمد. وطابورُ «فعّل بنفسه»
// كان ٢٤ ساعةً أصلاً — **لا يُمَسّ**، وكذلك أرشيفُ الرسائل (٣ أيّام) وبقيّةُ المسارات.
describe("🧹 عمرُ الطوابير المفتوحة", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  test("طابورُ البثّ يُسقط ما تجاوز ٢٤ ساعة — بوسمَيه حصراً", () => {
    const src = read("src/lib/broadcastQueue.ts");
    assert.ok(src.includes("error: { in: [QUEUE_MARK, CLAIM_MARK] },"), "الحذفُ غيرُ مقصورٍ على وسمَي طابور البثّ");
    assert.ok(src.includes("date: { lt: new Date(Date.now() - 24 * 3600_000) },"), "لا عمرَ للطابور");
  });

  test("طابورُ سجلّ المزامنة يُسقط ما تجاوز ٢٤ ساعة — بوسمِه ومفتاحِه حصراً", () => {
    const src = read("src/lib/syncAutoMsg.ts");
    assert.ok(src.includes("const QUEUE_MAX_AGE_MS = 24 * 3600_000;"), "لا عمرَ محدَّداً للطابور");
    assert.ok(src.includes("error: { in: [SYNC_MSG_MARK, CLAIM_MARK] },"), "الحذفُ غيرُ مقصورٍ على وسمَي الطابور");
    assert.ok(src.includes('dedupKey: { startsWith: "synclog:" },'), "الحذفُ غيرُ مقيَّدٍ بمفتاح سجلّ المزامنة");
  });

  test("🛡️ وما كان يُمسَح سلفاً لم يُمَسّ: «فعّل بنفسه» ٢٤ ساعةً وأرشيفُ الرسائل ٣ أيّام", () => {
    assert.ok(read("src/lib/selfActivatedNotice.ts").includes("مسحُ ما تجاوز ٢٤ ساعة"), "حارسُ الطابور القديم تغيّر");
    assert.ok(read("src/lib/scheduler.ts").includes("purgeOldMessages(days = 3)"), "أرشيفُ الرسائل تغيّر");
  });
});
