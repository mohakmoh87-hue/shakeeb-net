import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ البند ٥ · «تنصيبات خارجية» — للاطّلاع فقط (طلبُ محمد) ═════
//
// بنصّه: «أريد معرفةَ كم مشتركاً قامت الشركةُ بتنصيبه بلا علمي، ويمكنني تحديدُ ما أشاء
// من هذه القائمة واختيارُ **تجاهل** لمسحهم منها — **وهذه القائمةُ للاطّلاع فقط وليس
// شيءٌ آخر**».
//
// 🔴 وأخطرُ قرارٍ فيه كان قد يُفسدها كلَّها: **`createdByUser='sync'` لا يصلح إشارةً**.
//   قِيس على الإنتاج: **١٩٤٩١** مشتركاً أنشأتهم المزامنة، وأكثرُهم استيرادُ النقل الأوّل
//   (ولا `createdAt` على المشترك يُفرّق القديمَ من الجديد). فقائمةٌ بـ١٩٤٩١ صفّاً ضجيجٌ
//   يُخفي الخبر. ⇒ وسمٌ يُكتب **من الآن فصاعداً** و**بلا ردم**: تبدأ فارغةً (قِيس: صفر).

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const API = () => read("src/app/api/subscribers/external-installs/route.ts");

describe("البند ٥ · تنصيبات خارجية", () => {
  test("🔴 الإشارةُ وسمٌ مخصَّصٌ لا `createdByUser='sync'`", () => {
    const api = API();
    assert.match(api, /extInstallAt: \{ not: null \}/, "القائمةُ لا تعتمد الوسمَ المخصَّص");
    assert.equal(/createdByUser:\s*"sync"/.test(api), false,
      "القائمةُ تعتمد createdByUser ⇒ ١٩٤٩١ صفّاً من استيراد النقل الأوّل");
    // والوسمُ يُكتب في **كلا** مساري إنشاء المزامنة — ولو وُسِم أحدُهما لَغابت نصفُ الحالات
    const sync = read("src/lib/subscriptionSync.ts");
    assert.equal((sync.match(/extInstallAt: new Date\(\)/g) ?? []).length, 2,
      "مسارا الإنشاء في المزامنة ليسا موسومَين كلاهما");
  });

  test("«للاطّلاع فقط» قيدٌ في الشيفرة: لا حذفَ ولا مساسَ بمالٍ أو تاريخ", () => {
    const api = API();
    // «تجاهل» يكتب **وسماً واحداً** ولا شيءَ غيرَه
    assert.match(api, /data: \{ extIgnoredAt: new Date\(\) \}/, "التجاهلُ يكتب أكثرَ من الوسم");
    // ⚠️ والحكمُ على **مسار الكتابة** لا على الملفّ كلِّه: `dateTo` يظهر في `select`
    //   قراءةً للعرض — والقراءةُ ليست مساساً. (أوّلُ صياغةٍ لهذا التأكيد فحصت الملفَّ
    //   كلَّه فأدانت قراءةً بريئة — ودرسُه: حرسٌ فضفاضٌ يُدين الصحيحَ ثمّ يُسكَت.)
    const post = api.slice(api.indexOf("export async function POST"));
    for (const forbidden of ["delete", "carry:", "dateTo:", "moneyTx", "isDeleted: true"]) {
      assert.equal(post.includes(forbidden), false, `مسارُ الكتابة يمسّ ما لا يجوز: ${forbidden}`);
    }
    // ولا كتابةَ إلّا واحدةً في المسار كلِّه
    assert.equal((post.match(/prisma\.\w+\.(update|updateMany|delete|deleteMany|create|createMany)/g) ?? []).length, 1,
      "مسارُ التجاهل يكتب أكثرَ من مرّة");
  });

  test("🔒 العزلُ في **جملة التحديث** لا في فحصٍ سابقٍ وحدَه", () => {
    const api = API();
    // معرّفٌ لمشترك وكيلٍ آخرَ يُمرَّر في الطلب يجب ألّا يُصيب صفّاً
    assert.match(api, /where: \{ id: \{ in: parsed\.data\.ids \}, towerId: \{ in: towers \}/,
      "التجاهلُ بلا شرطِ المكتب في جملة التحديث ⇒ يمسّ مشتركَ وكيلٍ آخر");
    assert.match(api, /agentTowerIds/, "لا تحديدَ لمكاتب الوكيل");
    // وطلبُ مكتبٍ لا يتبع الوكيل يُرفَض صريحاً
    assert.match(api, /المكتب لا يتبع حسابك/, "لا رفضَ لمكتبٍ أجنبيّ");
  });

  test("سقفٌ على حجم الطلب — فلا تُمرَّر آلافُ المعرّفات في نداءٍ واحد", () => {
    assert.match(API(), /\.min\(1\)\.max\(500\)/, "قائمةُ المعرّفات بلا حدّ");
  });

  test("الزرُّ في مكانه المحفوظ بجانب «مشترك جديد» وبصلاحيّة", () => {
    const board = read("src/components/SubscribersBoard.tsx");
    const newAt = board.indexOf("+ مشترك جديد");
    const btnAt = board.indexOf("تنصيبات خارجية");
    assert.ok(newAt > -1 && btnAt > newAt && btnAt - newAt < 900, "الزرُّ ليس بجانب «مشترك جديد»");
    assert.match(board, /can\("subscribers\.manage"\) \|\| can\("subscribers\.import"\)/, "الزرُّ بلا صلاحيّة");
    // وعدّادُه يُقرأ من الصفوف نفسِها — لا حالةٌ ثانيةٌ تتأخّر عن أصلها
    assert.match(board, /extRows\.length > 0 \? ` \(\$\{extRows\.length\}\)` : ""/, "العدّادُ من حالةٍ مكرَّرة");
  });

  test("القائمةُ الفارغةُ تشرح نفسَها — فلا تُقرأ كعطب", () => {
    // قائمةٌ فارغةٌ بلا تفسيرٍ تُقرأ «الميزةُ لا تعمل»، والحقيقةُ أنّها ترصد من الآن
    assert.match(read("src/components/SubscribersBoard.tsx"), /من الآن فصاعداً/,
      "الفارغةُ بلا تفسيرٍ لماذا هي فارغة");
  });
});
