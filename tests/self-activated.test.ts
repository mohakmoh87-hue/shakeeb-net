import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ البند ٤-ب · «فعّل بنفسه» — رسالةٌ وطابورٌ ٢٤ ساعة ═════
//
// طلبُ محمد: «المشتركُ الذي فعّل اشتراكه بنفسه — يُعرَف من الـmanager: إن كان نفسَ اسم
// حساب المكتب ⇒ الوكيلُ فعّله، وإن كان غيرَه ⇒ فعّل بنفسه. ⇒ قالبٌ يُرسَل له عند
// المزامنة، **وطابورٌ إن كان الواتساب لا يعمل**، يُرسَل عند اشتغاله **ويُمسَح إن مرّت
// ٢٤ ساعةً ولم يُفتَح**.»
//
// 🎯 والقاعدةُ صارت مقيسةً لا مُفترَضة: فحصُ الساس الحيُّ (2026-08-13) أظهر تفعيلاتِ
//   المواصلات كلَّها باسم `FDT13-MU` (موقعُ المشترك في تطبيق سوبر سيل) وتفعيلاتِ الشدن
//   كلَّها باسم حساب المكتب.
//
// وأخطرُ ما فيه **التكرار**: المزامنةُ تُعيد قراءةَ تفعيلاتِ الأمس في كلّ دورة (كلَّ ١٠د)،
// فبلا ختمٍ صحيحٍ تصل الرسالةُ **١٤٤ مرّةً في اليوم**. وهو أسوأُ من حادثة الشدن (٤ نسخ).

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const LIB = () => read("src/lib/selfActivatedNotice.ts");

describe("البند ٤-ب · فعّل بنفسه", () => {
  test("🛡️ الختمُ **بتاريخ الانتهاء** لا بلحظة الإرسال", () => {
    // 🔑 المشتركُ يُفعّل بنفسه **كلَّ شهر**: فختمٌ بلحظةٍ يُسكِت تفعيلاتِه القادمةَ كلَّها،
    //   وختمٌ بتاريخ الانتهاء يُفرّق بين تفعيلٍ جديدٍ وإعادةِ قراءةِ القديم.
    const src = LIB();
    assert.match(src, /data: \{ selfActNoticeAt: dateTo \}/, "الختمُ ليس بتاريخ الانتهاء");
    assert.equal(/selfActNoticeAt: new Date\(\)/.test(src), false, "الختمُ بلحظةِ الإرسال ⇒ يُسكِت التفعيلاتِ القادمة");
    assert.match(src, /\{ selfActNoticeAt: \{ not: dateTo \} \}/, "لا مقارنةَ بالتاريخ ⇒ لا تمييزَ لتفعيلٍ جديد");
  });

  test("🛡️ الختمُ قبل الإرسال وذرّيّاً — والمزامنةُ تُعيد القراءةَ كلَّ دورة", () => {
    const src = LIB();
    const claimAt = src.indexOf("await prisma.subscriber.updateMany");
    const sendAt = src.indexOf("await sendViaProvider");
    assert.ok(claimAt > -1 && sendAt > -1 && claimAt < sendAt, "الختمُ بعد الإرسال ⇒ رسالةٌ كلَّ دورة");
    assert.match(src, /if \(claimed\.count !== 1\) return "skipped"/, "الخاسرُ في السباق لا يتخطّى");
  });

  test("الطابورُ في جدول الرسائل لا في `wa_relays` — بقياسٍ لا بذوق", () => {
    // نصُّ محمد: «wa_relays موجودٌ سلفاً — راجعه قبل جدولٍ جديد». والمراجعةُ أعطت:
    // **يُنظَّف كلُّ صفٍّ أقدمَ من ٥ دقائق** ⇒ لا يصلح طابوراً لـ٢٤ ساعة.
    const wa = read("src/lib/whatsapp.ts");
    assert.match(wa, /waRelay\.deleteMany\(\{ where: \{ createdAt: \{ lt: new Date\(Date\.now\(\) - 5 \* 60_000\)/,
      "شرطُ استبعاد wa_relays سقط — إن صار يُحفظ ٢٤ ساعةً فأعِد النظر في اختيار الطابور");
    const src = LIB();
    assert.match(src, /status: "PENDING"/, "لا طابورَ معلَّقٌ في جدول الرسائل");
    assert.match(src, /SELF_ACT_QUEUE_TTL_MS = 24 \* 60 \* 60 \* 1000/, "مهلةُ الطابور ليست ٢٤ ساعة");
  });

  test("🛡️ تصريفُ الطابور: ختمٌ ذرّيٌّ قبل كلّ إرسال، ومسحُ ما تجاوز ٢٤ ساعة", () => {
    const src = LIB();
    const fn = src.slice(src.indexOf("export async function drainSelfActivatedQueue"));
    const claimAt = fn.indexOf(`data: { status: "SENT", error: null }`);
    const sendAt = fn.indexOf("await sendViaProvider");
    assert.ok(claimAt > -1 && sendAt > -1 && claimAt < sendAt,
      "الصفُّ يُرسَل قبل ختمه ⇒ حاسبتان تُرسلان نسختَين من الطابور");
    assert.match(fn, /where: \{ id: m\.id, status: "PENDING" \}/, "الختمُ بلا شرطِ «ما زال معلَّقاً»");
    assert.match(fn, /m\.date < cutoff/, "لا مسحَ لما تجاوز المهلة");
  });

  test("🔒 العزل: لا يُرسَل صفٌّ من واتساب مكتبٍ ليس مكتبَ مشتركه", () => {
    const src = LIB();
    const fn = src.slice(src.indexOf("export async function drainSelfActivatedQueue"));
    // `Message` بلا علاقةٍ إلى `Subscriber`، فالنسبةُ تُبنى بمعرّف المشترك — ويجب أن تُقيَّد بالمكتب
    assert.match(fn, /where: \{ id: \{ in: subIds \}, towerId, isDeleted: false \}/, "لا تقييدَ بمكتب المشترك");
    assert.match(fn, /mine\.has\(m\.subscriberId\)/, "الصفوفُ تُرسَل بلا التحقّق من مكتبها");
  });

  test("الاستئنافُ عند الجهوزيّة **ودوريّاً** — لا أحدهما وحده", () => {
    // حدثُ «ready» يستأنف سريعاً، لكن لو كان الواتسابُ جاهزاً وفشل إرسالٌ عارضٌ فلا حدثَ
    // جديدٌ يأتي ⇒ يموت الصفُّ بعد ٢٤ ساعةً بلا محاولةٍ ثانية. فالدورةُ ضمانٌ لا ترف.
    assert.match(read("src/lib/whatsapp.ts"), /drainSelfActivatedQueue\(officeId\)/, "لا استئنافَ عند الجهوزيّة");
    assert.match(read("src/lib/scheduler.ts"), /drainSelfActivatedQueue\(o\.id\)/, "لا تصريفَ دوريّ");
  });

  // ═════ 🔴 بلاغُ محمد 2026-08-25 · «الرسائلُ ذهبت للأشخاص الخطأ» ═════
  // مقيسٌ على الإنتاج: **٤٨ رسالةً خاطئةً من ١١٥** في ثلاثين ساعة — ٢٢ لمن لا صفَّ له في
  // السجلّ إطلاقاً (أسقطهم حارسا «مغطّى» و«مقبوضٌ عندي») و٢٦ لأصحاب قروض، وستّةٌ وصلهم
  // قالبٌ ليس قالبَهم. والسببُ شرطٌ يتيمٌ `autoMsg.self && !managerMatch` لا يعرف السجلَّ.
  // وقاعدةُ محمد: «لكلّ حالةٍ وحسب الحالة تصل الرسالة».
  test("🔴 لا رسالةَ إلّا لصفٍّ **وُلد الآن** — لا للمنجر وحدَه", () => {
    const sync = read("src/lib/subscriptionSync.ts");
    assert.equal(/if \(autoMsg\.self && !managerMatch\b/.test(sync), false,
      "عاد المُطلِقُ اليتيم: رسالةٌ بمجرّد أنّ المنجرَ ليس حسابَ المكتب ⇒ ٤٢٪ منها لغير مستحقّيها");
    // النداءُ الوحيدُ لقالب «تفعيل خارجي» من المزامنة مشروطٌ بولادة صفٍّ فعلاً وبلا قرض
    assert.match(sync, /if \(outcome === "created" && !isLoanAct\) \{/,
      "الرسالةُ لم تعد مربوطةً بولادة صفٍّ في السجلّ");
    assert.match(sync, /const msgKind = managerIsPage \? null : ownCabinet \? "self" as const : "install" as const;/,
      "التصنيفُ الثلاثيُّ للرسالة سقط — كابينتُه ⇒ تفعيل خارجي · ديلر/شركة ⇒ تنصيب خارجي · صفحةُ المكتب ⇒ صمت");
    assert.match(sync, /msgKind === "self" \? autoMsg\.self : autoMsg\.install/,
      "جيك بوكسُ التبويب لم يعد يحرس رسالتَه (والافتراضيُّ إيقافُ الاثنين)");
  });

  test("🔒 الحرّاسُ الأربعةُ يسبقون الرسالةَ — كلٌّ في موضعه", () => {
    const sync = read("src/lib/subscriptionSync.ts");
    const send = sync.indexOf(`if (outcome === "created" && !isLoanAct) {`);
    assert.ok(send > -1, "موضعُ الإرسال لم يُعثر عليه");
    const loop = sync.slice(sync.indexOf("for (const a of actsWide) {"), send);
    // ١+٢· «مغطّى» و«مقبوضٌ عندي» يُخرجان الواقعةَ من الحلقة قبل أن تصل الرسالةَ أصلاً
    assert.match(loop, /if \(covered\) \{[\s\S]*?continue;/, "حارسُ «مغطّى» لم يعد يسبق الإرسال");
    assert.match(loop, /if \(await collectedByUs\([\s\S]*?continue;/, "حارسُ «مقبوضٌ عندي» لم يعد يسبق الإرسال");
    // ٣· القرضُ يُقاس بالسعر لا بالكارت (تصحيحُ محمد 2026-08-21)
    assert.match(loop, /const isLoanAct = Math\.round\(a\.price \|\| 0\) <= 0;/, "قاعدةُ القرض تغيّرت");
    // ٤· التصنيفُ الثلاثيُّ نفسُه الذي يبني التبويب — لا قاعدةٌ ثانيةٌ للرسالة
    assert.match(loop, /const managerIsPage = mgr\.toLowerCase\(\) === officeUser;/, "قاعدةُ «صفحةُ المكتب» تغيّرت");
    assert.match(loop, /const ownCabinet = isOwnCabinet\(/, "قاعدةُ «كابينةُ صاحبه» تغيّرت");
  });

  test("🚫 «تفعيلاتُ ساس» بلا رسالةٍ — وإلّا وصلته رسالتان لتفعيلٍ واحد", () => {
    // منجرٌ = صفحةُ المكتب ⇒ واقعةٌ تنتظر تسجيلَ وصلها، وحين يُسجَّل يُرسل مسارُ التفعيل
    // رسالتَه العاديّة. فرسالةٌ من المزامنة هنا ازدواجٌ لا إفادة.
    const sync = read("src/lib/subscriptionSync.ts");
    assert.match(sync, /managerIsPage \? null :/, "«تفعيلاتُ ساس» لم تعد مستثناةً من الرسائل");
    // ورسالةُ التفعيل العاديّة ما زالت في مسارها ولم تُمَسّ
    assert.match(read("src/app/api/subscribers/[id]/activate/route.ts"), /sendActivationMessage\(\{/, "مسارُ رسالة التفعيل العاديّة تغيّر");
  });

  test("لا يُفشل المزامنةَ ولا يُرسل لمن أُطفئ واتسابُه", () => {
    const src = LIB();
    assert.match(src, /} catch \{\s*\r?\n\s*return "skipped"; \/\/ لا يُفشل المزامنةَ/, "استثناءٌ قد يُسقط المزامنة");
    assert.match(src, /!sub\.waEnabled/, "يُرسَل لمشتركٍ أُطفئ واتسابُه");
    assert.match(src, /office\.waEnabled === "0"/, "يُرسَل من مكتبٍ واتسابُه مُطفأ");
  });
});
