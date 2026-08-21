import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 📋 «سجلّ المزامنة» الموحَّد — حلّ محلَّ «تنصيبات خارجية» (قرار محمد 2026-08-20) ═════
//
// بنصّه: أربعةُ تبويبات (تحديث معلومات · تنصيب خارجي · تفعيل خارجي · تفعيلات ساس)،
// العرضُ للمدير والمستخدم، والتعديلُ لصاحب صلاحيّة «تحديث سجل المزامنة» (ضمن المال)
// حصراً. المزامنةُ صارت **راصدةً**: لا استيرادَ تلقائيّاً ولا كتابةَ معلوماتٍ — تمديدُ
// التاريخ للأمام وحدَه بقي تلقائيّاً. (هذا الملفُّ ورث اسمَ حارس «تنصيبات خارجية».)

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const API = () => read("src/app/api/sync-log/route.ts");

describe("📋 سجلّ المزامنة الموحَّد", () => {
  test("🪦 الميزةُ القديمة أُزيلت كاملةً — لا مسارَين يتنازعان الحقيقة", () => {
    // «تنصيبات خارجية» و«سجل التدقيق» القديمان حُذفا؛ بقاءُ أيٍّ منهما = قائمتان تعرضان
    // الشيءَ نفسَه بحالتَين مختلفتَين
    assert.equal(fs.existsSync(path.join(ROOT, "src/app/api/subscribers/external-installs/route.ts")), false,
      "مسارُ «تنصيبات خارجية» القديم ما زال حيّاً");
    assert.equal(fs.existsSync(path.join(ROOT, "src/app/api/offices/[id]/sync-audit/route.ts")), false,
      "مسارُ «سجل التدقيق» القديم (أ-٢١) ما زال حيّاً");
    const board = read("src/components/SubscribersBoard.tsx");
    assert.match(board, /سجلّ المزامنة/, "زرُّ سجلّ المزامنة غائبٌ عن الشاشة الرئيسيّة");
    assert.match(board, /import SyncLogModal from "@\/components\/SyncLogModal"/, "النافذةُ غيرُ مركّبة");
    // والعدّادُ من الجلب نفسِه لا من حالةٍ مزدوجة
    assert.match(board, /syncCount > 0 \? ` \(\$\{syncCount\}\)` : ""/, "عدّادُ الزرّ غائب");
  });

  test("🔒 POST بصلاحيّة «تحديث سجل المزامنة» حصراً — والعرضُ للجميع", () => {
    const api = API();
    // العرضُ (GET) بجلسةٍ فقط، والأفعالُ (POST) خلف الصلاحيّة — قرارُ محمد نصّاً
    const post = api.slice(api.indexOf("export async function POST"));
    assert.match(post, /guard\("syncLog\.update"\)/, "POST بلا صلاحيّة syncLog.update");
    assert.ok(post.indexOf('guard("syncLog.update")') < post.indexOf("prisma."),
      "الحرسُ بعد أوّل نداءِ قاعدةٍ — لا قبله");
    // والصلاحيّةُ معرَّفةٌ ضمن مجموعة المال بالاسم الذي أملاه محمد
    const rbac = read("src/lib/rbac.ts");
    assert.match(rbac, /"syncLog\.update"/, "المفتاحُ غائبٌ عن rbac");
    assert.match(rbac, /تحديث سجل المزامنة/, "الاسمُ العربيُّ الذي أملاه محمد غائب");
  });

  test("🔒 العزلُ في **جملة الجلب** بالمعرّفات — معرّفٌ غريبٌ يسقط ولا يُنفَّذ", () => {
    const api = API();
    assert.match(api, /where: \{ id: \{ in: ids \}, towerId: \{ in: towers\.length \? towers : \[-1\] \}, status: "pending" \}/,
      "صفوفُ POST بلا شرطِ مكاتب الوكيل في SQL");
    assert.match(api, /agentTowerIds/, "لا تحديدَ لمكاتب الوكيل");
    // وGET كذلك
    assert.match(api, /where: \{ towerId: \{ in: towers \}, status: "pending" \}/, "GET بلا عزل");
  });

  test("💰 «إضافة تفعيل بوصل» و«إضافة دين» — المالُ بقرارات محمد الثلاثة", () => {
    const api = API();
    // (١) الوصلُ بيوم الضغط لا بيوم تفعيلة الساس
    assert.match(api, /date: now, dateFrom: now/, "الوصلُ ليس بيوم الضغط");
    // (٢) المبلغُ سعرُ باقة البرنامج — ويُرفَض من لا باقةَ له أو سعرُها صفر
    assert.match(api, /pkg\?\.priceDinar/, "المبلغُ ليس من باقة البرنامج");
    assert.match(api, /حدّد باقتَه وسعرَها أوّلاً/, "لا رفضَ لمن بلا باقةٍ مسعَّرة");
    // (٣) بلا سحب كارت — لا نداءَ ساسٍ في المسار كلِّه
    assert.equal(/sasFetch|sas4|index\/activation/.test(api), false, "المسارُ يسحب كارتاً من الساس");
    // الدَّينُ لا يقبض: moneyIn صفرٌ ويرتفع carry، وحركةُ الصندوق للوصل وحدَه
    assert.match(api, /moneyIn: isDebt \? 0 : price/, "الدَّينُ يقبض مالاً");
    assert.match(api, /carry: \{ increment: isDebt \? price : 0 \}/, "الدَّينُ لا يرفع carry ذرّيّاً");
    assert.match(api, /if \(!isDebt\) \{/, "حركةُ الصندوق غيرُ مشروطةٍ بالوصل");
    // والأثرُ الماليُّ كلُّه في معاملةٍ واحدة (قاعدة carry الذرّيّ)
    assert.match(api, /\$transaction/, "الوصلُ والحركةُ خارج معاملة");
    // «يحدث أيّام هذا المشترك»: التاريخُ الأبعدُ فقط — لا تقصيرَ لأيّام أحد
    assert.match(api, /r\.sasDateTo > sub\.dateTo/, "قد يُقصَّر تاريخُ مشتركٍ قائم");
  });

  test("«حفظ/تحديث» بلا وصلٍ إطلاقاً — قرارا محمد ج٢ وج٣", () => {
    // مسارُ apply (استيراد جديدٍ أو تطبيقُ معلومات) لا يقترب من المال
    const api = API();
    const applyAt = api.indexOf('if (action === "apply")');
    const sasAt = api.indexOf("// activate | debt");
    const apply = api.slice(applyAt, sasAt);
    // (`carry: 0` بداءةُ الماليّة النظيفة للبديل في الاستبدال — ليست قبضاً ولا ديناً؛
    //  الممنوعُ هو الوصلُ والحركةُ ورفعُ الدين)
    for (const forbidden of ["moneyTx", "subscriptionEntry", "wasel", "carry: { increment"]) {
      assert.equal(apply.includes(forbidden), false, `مسارُ التحديث يمسّ المال: ${forbidden}`);
    }
    // واليوزرُ الفيصل: لا صفَّ ثانياً ليوزرٍ قائم
    const whole = read("src/app/api/sync-log/route.ts");
    assert.match(whole, /يوزرُه موجودٌ سلفاً/, "استيرادُ السجلّ بلا حرسِ تكرار اليوزر");
  });

  test("🕊️ المزامنةُ راصدةٌ: لا استيرادَ تلقائيّاً ولا كتابةَ معلومات — والتاريخُ للأمام وحدَه", () => {
    const sync = read("src/lib/subscriptionSync.ts");
    // الاستيرادُ الجماعيُّ وملءُ الباقات حُذفا (الاسمان في الشيفرة الحيّة لا التعليقات)
    assert.equal(/toImport\.push|pkgFixQueue\.push|const toImport|const pkgFixQueue/.test(sync), false,
      "بقايا الاستيراد التلقائيّ حيّة");
    // الجديدُ يُرصَد تنصيباً والفروقُ تُرصَد معلوماتٍ
    assert.match(sync, /recordInstall\(/, "الجديدُ لا يُرصَد");
    assert.match(sync, /recordInfoDiff\(/, "فروقُ المعلومات لا تُرصَد");
    // وتمديدُ التاريخ **للأمام فقط** هو الكتابةُ الوحيدةُ الباقية على المشترك
    assert.match(sync, /sasDateIsLater\(p\.dateTo, validDate\)/, "التمديدُ التلقائيُّ للأمام زال — وهو قرارُ محمد أن يبقى");
  });

  test("🪟 النافذةُ منتصفَ الشاشة 80% ولا تُغلق إلّا بـ✕ — شرطُ محمد الثابت", () => {
    const modal = read("src/components/SyncLogModal.tsx");
    // على الحاسوب 80% (شرطُ محمد)، وعلى الهاتف شبهُ كاملةٍ (بلاغُه: 80% تقصّ التبويبات)
    assert.match(modal, /md:h-\[80vh\] md:w-\[80vw\]/, "ليست 80% من الشاشة على الحاسوب");
    assert.match(modal, /h-\[92vh\] w-\[96vw\]/, "الهاتفُ بلا مقاسٍ شبهِ كامل — التبويباتُ تُقصّ");
    assert.match(modal, /overflow-x-auto/, "شريطُ التبويبات لا ينزلق أفقيّاً على الضيّق");
    assert.match(modal, /items-center justify-center/, "ليست منتصفَ الشاشة");
    // الطبقةُ الخلفيّة **بلا onClick** — الإغلاقُ بزرّ ✕ حصراً
    const overlayAt = modal.indexOf('fixed inset-0 z-[130]');
    const overlayLine = modal.slice(modal.lastIndexOf("<div", overlayAt), modal.indexOf(">", overlayAt));
    assert.equal(overlayLine.includes("onClick"), false, "النقرُ على الفراغ يُغلق — ومحمد اشترط ✕ حصراً");
    assert.match(modal, /aria-label="إغلاق"/, "زرُّ ✕ غائب");
    // والتبويباتُ الأربعةُ بأسمائها
    for (const t of ["تحديث معلومات", "تنصيب خارجي", "تفعيل خارجي", "تفعيلات ساس"]) {
      assert.ok(modal.includes(t), `تبويب «${t}» غائب`);
    }
  });

  test("🔐 الحاسباتُ تكتب السجلَّ ⇒ GRANT + سياسةُ عزلٍ (قاعدةُ «كتابة جديدة = GRANT + سياسة»)", () => {
    const script = read("scripts/add-sync-log.mjs");
    assert.match(script, /GRANT SELECT, INSERT, UPDATE ON sync_log TO agent_worker/, "لا GRANT للحاسبات");
    assert.match(script, /GRANT USAGE, SELECT ON SEQUENCE sync_log_id_seq TO agent_worker/, "INSERT بلا حقّ التسلسل يفشل");
    assert.match(script, /CREATE POLICY rls_sync_log/, "لا سياسةَ عزل");
    // وملفُّ السياسات المرجعيُّ يحملها (حارسُ rls-coverage يقرؤه)
    assert.match(read("prisma/rls/03-policies.sql"), /rls_sync_log/, "السياسةُ غائبةٌ عن الملفّ المرجعيّ");
  });

  test("📨 طابورُ الرسائل دائمٌ لا يُمسَح — وحارسُ تكرارٍ فيزيائيّ (نصّ محمد 2026-08-21)", () => {
    const q = read("src/lib/syncAutoMsg.ts");
    // «لا يمسح ابدا»: لا حذفَ صفوفٍ من القاعدة — التعذُّرُ يُعيد للطابور لا يمحو ولا يختم فشلاً
    // (⚠️ والحكمُ على حذف القاعدة حصراً: `draining.delete` حذفُ عنصرِ Set بريءٌ — لا يُدان)
    assert.equal(/prisma\.message\.delete|\.deleteMany\(/.test(q), false, "الطابورُ يمسح رسائلَ — ومحمد اشترط ألّا تُمسَح أبداً");
    assert.equal(/status: "FAILED"/.test(q), false, "صفٌّ يُختَم فاشلاً فيموت — والمطلوبُ انتظارُ الحاسبة");
    // «حارس يمنع التكرار بأي شكل»: مفتاحٌ فريدٌ في القاعدة (فهرس dedupKey الجزئيّ) + صدُّ P2002
    assert.match(q, /dedupKey: syncMsgDedupKey\(/, "الإدراجُ بلا مفتاح منع التكرار");
    assert.match(q, /P2002/, "اصطدامُ الفهرس الفريد لا يُلتقط ⇒ ينفجر بدل «duplicate»");
    // والحَجزُ قبل الأثر: الإدراجُ أوّلاً ثمّ حَجزٌ ذرّيٌّ قبل أيّ إرسال
    assert.match(q, /where: \{ id: rowId, status: "PENDING", error: SYNC_MSG_MARK \}/, "إرسالٌ بلا حَجزٍ ذرّيّ");
    // «يرسل فور اشتغال الحاسبة»: التصريفُ معلّقٌ على جهوزيّة الواتساب وعلى دورة المجدول
    assert.match(read("src/lib/whatsapp.ts"), /drainSyncMsgQueue\(officeId\)/, "لا تصريفَ عند جهوزيّة واتساب الحاسبة");
    assert.match(read("src/lib/scheduler.ts"), /drainSyncMsgQueue\(o\.id\)/, "لا تصريفَ دوريّاً");
    // 🔒 والعزل: صفوفُ المكتب تُلتقط بمفتاحها (المكتبُ جزءٌ منه) — يشمل الجددَ بلا subscriberId
    assert.match(q, /startsWith: `synclog:self:t\$\{towerId\}:`/, "تصريفٌ بلا عزلِ مكتبٍ في المفتاح");
    // والحَجزُ الميّتُ (انهيارٌ وسط الإرسال) يُحرَّر — فلا صفَّ يخلد محجوزاً بلا إرسال
    assert.match(q, /STALE_CLAIM_MS/, "لا تحريرَ لحَجزٍ مات صاحبُه");
  });

  test("😴 قبل لصق الـSQL: خمولٌ هادئ لا انفجار (P2021)", () => {
    const api = API();
    assert.match(api, /P2021/, "المسارُ ينفجر إن غاب الجدول");
    assert.match(api, /dormant: true/, "GET لا يُعلن الخمول");
    assert.match(read("src/lib/syncLog.ts"), /P2021/, "محرّكُ الرصد ينفجر إن غاب الجدول — فتسقط المزامنةُ كلُّها");
  });
});
