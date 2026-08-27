import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 👥💰 البنود أ+ب+ج+د — التفاصيلُ الماليّةُ بحسب المستخدم (طلبُ محمد 2026-08-26) ═════
//
// القاعدةُ الحاكمة بنصّه: «مكتبٌ لديه مستخدمٌ واحد، أو مستخدمان حسابُهما غيرُ منفصل ⇒
// يبقى نفسُ الوضع الحاليّ بالضبط: يظهر له فقط المكتبُ وبدون أيّ تغييرٍ له إطلاقاً».
// فشرطُ كلِّ تفصيلٍ بالمستخدم هو **«حساب منفصل»** (`separateAccount`) — في التقرير الحيّ
// واليومِ السابق والمدى وأرباح الشركة سواء.
//
// 🔬 وقبلها قِيس المسحُ الماليُّ الكامل: كلُّ كاتبِ مالٍ يختم قابضَه (٩ كتّاب money_tx ·
// ٣ subscription_entries · ٢ invoices · ٤ manager_tx) — فالتفصيلُ بالمستخدم صادقٌ بالبناء.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ROUTE = () => read("src/app/api/reports/daily/route.ts");
const LIB = () => read("src/lib/dailyReport.ts");
const MA = () => read("src/app/(app)/manager-accounts/page.tsx");
const PROFITS = () => read("src/lib/profits.ts");

describe("د · «الحساب المنفصل» شرطُ كلّ تفصيلٍ بالمستخدم", () => {
  // 🔄 حُدِّث بعد حالة كاسبر (2026-08-26): الفصلُ حكمٌ على **المكتب** — مؤشَّرٌ واحدٌ
  //    يفصل الجميعَ، فيظهر الأوّلُ (الذي لا يُعرَض عليه المربّعُ عند إنشائه) في التبويبات.
  test("تبويباتُ الشاشة الرئيسيّة: مكتبٌ فيه مؤشَّرٌ ⇒ كلُّ مستخدميه — وبلا مؤشَّرٍ لا أحد", () => {
    const src = read("src/app/(app)/dashboard/page.tsx");
    assert.match(src, /const sepTowers = new Set\(us\.filter\(\(u\) => u\.separateAccount\)/,
      "مجموعةُ المكاتب المفصولة سقطت — عاد الحكمُ للفرد فيغيب الأوّلُ غيرُ المؤشَّر");
    assert.match(src, /sepTowers\.has\(u\.towerId\) && \(perTower\.get\(u\.towerId as number\) \?\? 0\) >= 2/,
      "شرطُ (مكتبٌ مفصولٌ + اثنان فأكثر) سقط — قاعدةُ د تنكسر");
  });

  test("والمحرّك: reportUserScope يحكم بالمكتب — فأبو فهد يُجبَر على تقريره ولو بلا مؤشَّر", () => {
    const lib = LIB();
    assert.match(lib, /return \(await officeSeparated\(session\.towerId\)\) \? session\.userId : undefined;/,
      "🔴 عاد الحكمُ بعلَم الفرد ⇒ غيرُ المؤشَّر يرى مالَ زملائه كلَّه (بلاغ أبو فهد)");
    assert.match(lib, /return us\.length >= 2 && us\.some\(\(u\) => u\.separateAccount\);/,
      "تعريفُ «مكتبٌ منفصل» تغيّر — مستخدمان+ وفيهم مؤشَّرٌ واحدٌ على الأقلّ");
  });

  test("وقائمةُ اليوم السابق كذلك — والشرطُ اثنان+ وإلّا لا قائمةَ أصلاً", () => {
    const src = ROUTE();
    // 🔄 حالة كاسبر: تُجلب قائمةُ الجميع، والشرطُ (اثنان+ وفيهم مؤشَّر) ⇒ يظهر **الكلُّ**
    assert.match(src, /if \(us\.length >= 2 && us\.some\(\(u\) => u\.separateAccount\)\) \{/,
      "شرطُ فصل المكتب سقط — يغيب الأوّلُ غيرُ المؤشَّر أو تظهر تبويباتٌ لغير المفصولين");
    // 🔒 وللمدير ولمكتبٍ محدّدٍ فقط — «الكل» لا تبويبات له
    assert.match(src, /session\.isAdmin && typeof scope === "number" && scope > 0/,
      "القائمةُ تُبنى لغير المدير أو للإجماليّ");
  });

  test("وأرباحُ الشركة: القائمةُ من المنفصلين، وغيرُهم لا يُعَدّ ولا يظهر قسمُهم", () => {
    const src = PROFITS();
    assert.match(src, /const sepTowerSet = new Set\(allOfficeUsers\.filter\(\(u\) => u\.separateAccount\)/,
      "مجموعةُ مكاتب الأرباح المفصولة سقطت — يغيب الأوّلُ غيرُ المؤشَّر عن القسم");
    assert.match(src, /sepTowerSet\.has\(u\.towerId\) && \(perTowerCount\.get\(u\.towerId\) \?\? 0\) >= 2/,
      "شرطُ (مكتبٌ مفصولٌ + اثنان فأكثر) سقط من الأرباح");
    assert.match(src, /if \(uid == null \|\| !sepById\.has\(uid\)\) return;/,
      "🔴 يُعَدّ لمستخدمٍ غير منفصل ⇒ يظهر قسمٌ لمكتبٍ قاعدتُه «المكتبُ فقط»");
    assert.match(src, /if \(byUserAcc\.size\) \{/, "قسمُ byUser يُبنى فارغاً بدل غيابه — تغييرُ عرضٍ لغير المفصولين");
  });
});

describe("أ · تبويباتُ اليوم السابق — بسطر الماستر وحفره", () => {
  test("openDay يقبل المستخدمَ ويرسله، والتبويباتُ من ردّ الخادم", () => {
    const src = MA();
    assert.match(src, /async function openDay\(day: string, towerId: number \| null, userId: "all" \| number = "all", to\?: string\)/,
      "توقيعُ openDay فقد المستخدمَ أو المدى");
    assert.match(src, /if \(userId !== "all"\) q\.set\("userId", String\(userId\)\);/, "المستخدمُ لا يُرسَل للخادم");
    assert.match(src, /setDayUsers\(Array\.isArray\(d\?\.officeUsers\) \? d\.officeUsers : \[\]\);/,
      "التبويباتُ لا تُبنى من ردّ الخادم — أيُّ مصدرٍ آخرَ يكسر شرطَ الفصل");
    assert.match(src, /\{dayUsers\.length >= 2 && \(/, "شرطُ الاثنين+ سقط من العرض");
  });

  test("والحفرُ يحمل المستخدمَ إلى العارض المشترك", () => {
    const src = MA();
    assert.match(src, /userId: dayUser === "all" \? null : dayUser/, "ضغطُ المربّع لا يُمرّر المستخدمَ للحفر");
    assert.match(src, /userId=\{drill\.userId \?\? null\}/, "TxDrillModal لا يستلم المستخدم");
    // وإعادةُ الجلب بعد حذف حركةٍ تحفظ المستخدمَ والمدى — وإلّا قفز التقريرُ إلى «الكل»
    assert.match(src, /openDay\(dayView\.day, dayView\.towerId, dayUser, dayView\.to\)/,
      "onChanged يفقد المستخدمَ أو المدى بعد حذف حركة");
  });
});

describe("ج · «بين تاريخين» — نفسُ المحرّك بنافذةٍ أوسع", () => {
  test("المحرّك: endDay يمدّ النهايةَ والقديمُ يعمل حرفيّاً بلا endDay", () => {
    const src = LIB();
    assert.match(src, /endDay\?: Date,/, "توقيعُ computeDailyReport فقد المدى");
    assert.match(src, /const end = endDay \? iraqTodayRange\(endDay\)\.end : sameDayEnd;/,
      "نهايةُ المدى لا تُشتقّ من endDay");
    // 🔒 مدىً مقلوبٌ لا يُنتج نافذةً فارغةً تُعرَض أصفاراً مضلِّلة
    assert.match(src, /end < start \? sameDayEnd : end/, "حارسُ المدى المقلوب سقط");
  });

  test("والمسار: from/to يغلبان day، والمدخلُ مفحوصُ الصيغة", () => {
    const src = ROUTE();
    assert.match(src, /const ranged = fromD != null && toD != null;/, "شرطُ اكتمال الطرفَين سقط");
    assert.match(src, /computeDailyReport\(scope, ranged \? fromD : day, userId, ranged \? toD : undefined\)/,
      "المدى لا يصل المحرّكَ أو يكسر نداءَ اليوم الواحد");
    assert.match(src, /if \(!v \|\| !\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(v\)\) return undefined;/,
      "صيغةُ التاريخ لا تُفحَص — مدخلٌ حرٌّ إلى new Date");
  });

  test("والواجهة: زرُّ الكشف مشروطٌ بطرفَين سليمَين، والحفرُ معطَّلٌ في المدى", () => {
    const src = MA();
    assert.match(src, /disabled=\{!rangeFrom \|\| !rangeTo \|\| rangeTo < rangeFrom\}/,
      "زرُّ الكشف يقبل مدىً ناقصاً أو مقلوباً");
    // الحفرُ يومٌ واحدٌ بطبعه — ففي المدى تُعطَّل الضغطاتُ كي لا تُعرَض سطورُ يومٍ تحت مجموعِ شهر
    assert.match(src, /if \(!dayView\.to\) setDrill\(\{ kind, day: dayView\.day/,
      "🔴 الحفرُ مفتوحٌ في وضع المدى ⇒ سطورُ اليوم الأوّل تحت مجموع الشهر كلِّه");
  });
});

describe("ب · أرباحُ الشركة بحسب المستخدم — الإسنادُ بالوصل المختوم", () => {
  test("التفعيلُ الداخليّ يُنسَب لختم وصله، والتنصيبُ لقابض وصل نافذته", () => {
    const src = PROFITS();
    assert.match(src, /select: \{ id: true, subscriberId: true, date: true, month: true, cardType: true, userId: true \}/,
      "استعلامُ الوصولات لا يقرأ الختم");
    assert.match(src, /bump\(e\.userId, "act", months\);/, "عدُّ التفعيل الداخليّ للمستخدم سقط");
    assert.match(src, /if \(inside && sub\) bump\(receiptUserAfter\(sub\.id, at, INSTALL_RECEIPT_MS\), "inst"\);/,
      "التنصيبُ الداخليّ لا يُنسَب لقابض وصله");
    // 🔑 الإسنادُ بأقرب وصلٍ في النافذة — نفسِ الوصل الذي جعل التنصيبَ «داخليّاً»
    assert.match(src, /const receiptUserAfter = \(subId: number, at: Date, span: number\): number \| null =>/,
      "دالّةُ قابض الوصل غائبة");
  });

  test("🔒 والخارجيّان بلا نسبةٍ لأحد — والحسابُ الماليُّ لم يُمَسّ", () => {
    const src = PROFITS();
    // لا bump في فرعَي actExt/instExt — الخارجيُّ ترصده المزامنةُ بلا يدِ أحد
    const extAct = src.slice(src.indexOf("const box = out.boxes.actExt;"), src.indexOf("const box = out.boxes.actExt;") + 400);
    assert.equal(/bump\(/.test(extAct), false, "🔴 الخارجيُّ يُنسَب لمستخدمٍ — ولا يدَ لأحدٍ فيه");
    // ومعادلةُ الصافي كما هي حرفيّاً — ب قراءةٌ محضةٌ فوقها
    assert.match(src, /out\.net = B\.actIn\.profit \+ B\.actExt\.profit \+ B\.instIn\.profit \+ B\.instExt\.profit/,
      "معادلةُ صافي الأرباح تغيّرت — وب عرضٌ لا حساب");
  });

  test("والواجهة: القسمُ غائبٌ كلّيّاً حين لا مفصولين", () => {
    const panel = read("src/components/ProfitsPanel.tsx");
    assert.match(panel, /\{\(rep\?\.byUser\?\.length \?\? 0\) > 0 && \(/,
      "قسمُ المستخدمين يظهر فارغاً بدل غيابه — تغييرُ عرضٍ لمن لا فصلَ عنده");
  });
});

// ═════ 🙈 تفصيلُ اللوحات يُحجَب عن المستخدم المنفصل — بلاغُ محمد 2026-08-26 مساءً ═════
// «لماذا يظهر من فادي ومن كاسبر؟ المفروض كلُّ مستخدمٍ وله حسابُه ما يظهر له البقيّة».
// 🔬 والحقيقةُ المقيسة: السطورُ **أسماءُ لوحاتِ ساسٍ** (أ-٢٣) لا أشخاص — لوحتا كاسبر
// مسمّاتان باسمَي الشريكَين — والأرقامُ كانت مرشَّحةً بالمستخدم فعلاً (لا تسريبَ مال).
// لكنّها التباسٌ بلا فائدةٍ لمعزولٍ ⇒ تُحجَب عنه، وتبقى للمدير ولغير المفصولين (صميم).
describe("🙈 تفصيلُ اللوحات والمستخدمُ المنفصل", () => {
  test("يُحجَب عن المُجبَر وحدَه — في المسار وفي أوّل تحميلٍ للرئيسيّة", () => {
    assert.match(ROUTE(), /if \(!session\.isAdmin && userId != null\) delete \(r as \{ byPanel\?: unknown \}\)\.byPanel;/,
      "المسارُ يعيد تفصيلَ اللوحات لمستخدمٍ معزول");
    assert.match(read("src/app/(app)/dashboard/page.tsx"), /if \(forcedUser != null\) delete \(initialReport as \{ byPanel\?: unknown \}\)\.byPanel;/,
      "أوّلُ تحميلٍ للرئيسيّة يعرض تفصيلَ اللوحات لمعزولٍ قبل أيّ جلب");
  });

  test("🔒 وعدُّ اللوحات نفسُه يبقى مرشَّحاً بالمستخدم — دفاعُ العمق قائم", () => {
    // لو سقط الحجبُ يوماً، يبقى العدُّ أرقامَ المستخدم وحدَه لا أرقامَ المكتب
    assert.match(LIB(), /where: \{ isDeleted: false, isMaster: false, \.\.\.dateWhere, \.\.\.towerWhere, \.\.\.userWhere \},\s*\r?\n\s*select: \{ subscriberId: true \}/,
      "عدُّ تفصيل اللوحات فقد فلترَ المستخدم — تسريبُ أعدادٍ لمعزول");
  });
});
