import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 📍 موقعُ العمود: من الفنيّ إلى قبول المدير — حرّاسُ السلسلة ═════
//
// 🔴 بلاغُ محمد 2026-08-24: «الإشعارُ يظهر ولا يمكن الضغط عليه». وكشف الفحصُ عطلَين
//   حاجبَين **معاً**، فلو أُصلح أحدُهما وحدَه لبقي المديرُ بلا طريق:
//   ① جرسُ الإشعارات لا يعرف النوعَ `map-proposal` ⇒ `onClick` يخرج من أوّل سطر.
//   ② وزرُّ «مواقع الأعمدة» **كودٌ ميّت**: وُلد داخل شريط الفنيّين (شرطُه `isTech`)
//      وشرطُه هو `canManage` — والخادمُ يعطي الفنيَّ `canManage:false` فلا يجتمعان أبداً.
//   وهذه الحرّاسُ تمنع عودةَ أيٍّ منهما.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const BELL = () => read("src/components/NotificationsBell.tsx");
const PAGE = () => read("src/app/(app)/field-management/page.tsx");
const API = () => read("src/app/api/field/map-proposal/route.ts");

describe("📍 اقتراحُ موقع العمود — من الإشعار إلى القبول", () => {
  test("① الجرسُ يعرف النوعَ `map-proposal` ويفتح نافذةَ `map-proposals`", () => {
    const bell = BELL();
    assert.match(bell, /"map-proposal": \{ modal: "map-proposals"/,
      "الجرسُ لا يعرف نوعَ إشعار العمود ⇒ النقرُ يخرج فارغاً كما في البلاغ");
    // ⚠️ فخُّ التسمية: النوعُ مفردٌ واسمُ النافذة جمع — والصفحةُ تنتظر الجمعَ حرفاً
    assert.match(PAGE(), /which === "map-proposals"\) setMapModal\(true\)/,
      "اسمُ النافذة تغيّر فانقطع ما يفتحه الجرس");
    assert.match(bell, /"map-proposal": "📍"/, "رمزُ الإشعار غائبٌ فيظهر بالجرس العامّ");
  });

  test("② للمدير مدخلٌ حيٌّ إلى شاشة المواقع — لا كودٌ ميّت", () => {
    const page = PAGE();
    // المدخلُ داخل قائمة «اللوحة والسجلّات» في شريط المدير
    const menu = page.slice(page.indexOf('FieldMenu title="اللوحة والسجلّات"'), page.indexOf("</FieldMenu>", page.indexOf('FieldMenu title="اللوحة والسجلّات"')));
    assert.ok(menu.length > 50, "قائمةُ «اللوحة والسجلّات» لم يُعثر عليها");
    assert.match(menu, /setMapModal\(true\)/, "مدخلُ مواقع الأعمدة غائبٌ عن شريط المدير");
    assert.match(menu, /mapPending/, "شارةُ المعلَّق غائبةٌ عن المدخل");
    // 🪦 ولا يعود زرٌّ إلى شريط الفنيّين: كلُّ `setMapModal(true)` خارج مستمع الإشعار يجب
    //    أن يكون داخل قائمة المدير — وشريطُ الفنيّين شرطُه isTech فلا يراه مديرٌ أبداً.
    const techBar = page.slice(page.indexOf("{isTech && offices.length > 0 && ("));
    const techBarEnd = techBar.indexOf("{/* شريط دعم اليوم الكامل");
    assert.equal(/setMapModal\(true\)/.test(techBar.slice(0, techBarEnd > 0 ? techBarEnd : 4000)), false,
      "عاد زرُّ المواقع إلى شريط الفنيّين — وهو فرعٌ لا يُصيَّر لمديرٍ أبداً");
  });

  test("③ الإشعارُ يحمل رابطَه — فلا يولد نوعٌ جديدٌ ميّتَ النقر", () => {
    assert.match(read("src/lib/notify.ts"), /url: opts\.url \?\? null/, "الرابطُ يُستقبَل ولا يُخزَّن");
    assert.match(read("prisma/schema.prisma"), /url {10}String\?/, "عمودُ الرابط غائبٌ عن نموذج الإشعار");
    // والجرسُ يستعمله ملاذاً لكلّ نوعٍ لا تعرفه خريطتُه
    assert.match(BELL(), /else if \(n\.url\) window\.location\.assign\(n\.url\)/, "الرابطُ المخزَّن لا يُستعمَل عند النقر");
    // ⏳ وقبل لصقِ عمودِ SQL لا تتوقّف الإشعارات: تُعاد الكتابةُ بالحقول القديمة
    assert.match(read("src/lib/notify.ts"), /catch \{ \/\* لا يُفشل الحدث الأصلي \*\/ \}/,
      "غيابُ العمود قبل اللصق يوقف الإشعارات كلَّها");
  });

  test("④ إشعارُ التطبيق يحمل الوجهة (FCM data)", () => {
    assert.match(read("src/lib/fcm.ts"), /\.\.\.\(url \? \{ data: \{ url \} \} : \{\}\)/, "رابطُ FCM يُرمى فيفتح التطبيقَ بلا شاشة");
    assert.match(read("src/lib/push.ts"), /sendFcmNotification\(u\.fcmToken, payload\.title, payload\.body, payload\.url\)/, "الرابطُ لا يُمرَّر إلى FCM");
  });

  test("⑤ لا إشعارَ مكرّرٌ لإعادة الإرسال · والمكاتبُ المحذوفةُ تُستثنى", () => {
    const api = API();
    assert.match(api, /if \(!pending\) \{\s*await notify\(/, "إعادةُ الإرسال تزرع إشعاراً جديداً لعمودٍ واحد");
    assert.match(api, /agentId: params\.agentId \?\? -1, isDeleted: false/, "مكاتبُ الوكيل تُجلب بلا استثناء المحذوفة");
  });

  test("🔒 القبولُ يبقى محروساً كما هو — لا يُطمَس عمودٌ مثبَّت", () => {
    const api = API();
    assert.match(api, /guard\("field\.manage"\)/, "مسارُ القبول بلا صلاحيّة");
    assert.match(api, /ownsTower\(g\.session, row\.towerId\)/, "القبولُ بلا عزلِ مكتب");
    assert.match(api, /const exists = await prisma\.mapPoint\.findUnique\(\{ where: \{ name: row\.name \} \}\)/,
      "سقط فحصُ «العمودُ موجودٌ أصلاً» ⇒ الطمس");
    assert.match(api, /action: "MAP_POINT_ADD"/, "القبولُ بلا أثرٍ في سجلّ التدقيق");
  });
});
