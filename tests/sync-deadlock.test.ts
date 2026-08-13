import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🔴 مزامنةٌ لا تنتهي ولا تتوقّف (بلاغُ محمد عن صفاء 2026-08-13) ═════
//
// الحادثةُ مقيسة: راية `manualSync:42` بقيت `running` **٧٥ ساعةً** (من ١٠ آب)، ومعها
// `cancel: true` — أي أنّ صفاءَ ضغط «إيقاف» ولم يُستجَب له. والعُقدةُ ثلاثيّةُ الإحكام:
//   • الحالةُ تُكتب في القاعدة، ثمّ يموت صاحبُها (نشرةٌ/إعادةُ تشغيل/انهيار)،
//     و**ليس في البرنامج شيءٌ يحصد رايةً عالقة** ⇒ «جارية» إلى الأبد.
//   • فالواجهةُ تستطلع فترى «جارية» ⇒ دوّارةٌ لا تقف، و«مزامنة الآن» **مُعطَّل**.
//   • وزرُّ «إيقاف» يرفع رايةً **تعاونيّة** — ولا حلقةَ حيّةً تقرؤها.
//
// 🔑 والدرسُ: **مهلةٌ من وقت البدء لا تُفرّق** بين مزامنةٍ طويلةٍ حيّةٍ وأخرى ميّتة.
//   أمّا انقطاعُ النبض فدليلُ موتٍ قاطع. فالحرسُ على النبضة وعلى حصادها.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SRC = () => read("src/lib/subscriptionSync.ts");

describe("المزامنةُ اليدويّة لا تعلق أبداً", () => {
  test("نبضةٌ دوريّةٌ تُفكّ في `finally` — فموتُ العمليّة يوقفها فوراً", () => {
    const s = SRC();
    assert.match(s, /function beatManualSync\(/, "لا نبضةَ حياةٍ إطلاقاً");
    assert.match(s, /setInterval\(\(\) => \{ void beatManualSync\(officeId\)/, "النبضةُ لا تُطلَق مع المزامنة");
    // ⚠️ ولا يكفي إطلاقُها: بلا `finally` تبقى نابضةً بعد انتهاء العمل فتُخفي موتاً لاحقاً
    const body = s.slice(s.indexOf("export async function runManualSync"));
    assert.match(body.slice(0, 4000), /finally \{\s*\r?\n?\s*clearInterval\(beat\)/, "النبضةُ لا تُفكّ في finally");
  });

  test("النبضةُ تُكتب ISO بـ`Z` — وإلّا قُرئت بتوقيت بغداد فبدت في المستقبل", () => {
    // 🎯 علّةٌ اصطيدت **قبل النشر**: `::text` تُخرج «2026-08-13 18:47:42.3» بلا منطقة،
    //   وجافاسكربت يقرؤها **محلّيّةً** ⇒ بغدادُ UTC+3 تجعل النبضةَ متقدّمةً ٣ ساعات،
    //   فلا تُدان مزامنةٌ ميّتةٌ أبداً وتعود العُقدةُ نفسُها من بابٍ آخر.
    const s = SRC();
    assert.match(s, /'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'/, "النبضةُ بصيغةٍ بلا منطقةٍ زمنيّة");
    assert.equal(/to_jsonb\(\(NOW\(\) AT TIME ZONE 'UTC'\)::text\)/.test(s), false, "عودةٌ إلى ::text الغامضة");
  });

  test("النبضةُ جرّاحيّةٌ (`jsonb_set`) فلا تطمس مؤشّرَ التقدّم", () => {
    // قراءةٌ-فكتابةٌ ساذجةٌ تسحق `progress` الذي تكتبه الحلقةُ في اللحظة نفسِها،
    // فيرتدّ المؤشّرُ إلى الوراء أمام محمد بلا سبب ظاهر.
    const s = SRC();
    assert.match(s, /jsonb_set\(text::jsonb, '\{beatAt\}'/, "النبضةُ لا تمسّ مفتاحاً واحداً");
    assert.match(s, /text::jsonb ->> 'state' = 'running'/, "النبضةُ قد تُحيي حالةً انتهت");
  });

  test("قراءةُ الحالة تحصد المنقطعةَ وتُثبّتها — فتشفى ذاتيّاً لكلّ من يفتح الصفحة", () => {
    const s = SRC();
    assert.match(s, /MANUAL_SYNC_DEAD_MS/, "لا مهلةَ موتٍ");
    const fn = s.slice(s.indexOf("export async function getManualSyncStatus"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.match(body, /st\.beatAt \?\? st\.startedAt/, "الحصادُ يقيس من وقت البدء لا من النبضة");
    assert.match(body, /state: "error"/, "المنقطعةُ لا تُختَم خطأً فتبقى «جارية»");
    assert.match(body, /setManualSyncStatus\(officeId, dead\)/, "النتيجةُ لا تُثبَّت ⇒ تُحصَد في كلّ قراءةٍ بلا شفاء");
  });

  test("«إيقاف» يُستجاب له في المرحلة الأولى أيضاً — لا بعد فحصِ كلّ الكروت", () => {
    // صفاءُ كان في `step: sync` (المرحلةُ الأولى: ١٢٠ يوماً من الساس) — والإلغاءُ كان
    // يُفحَص **داخل فحص الكروت وحدَه**، فطلبُه لم يكن ليُقرأ أصلاً.
    const s = SRC();
    const body = s.slice(s.indexOf("export async function runManualSync"));
    const phase1 = body.slice(0, body.indexOf('step: "cards"'));
    assert.match(phase1, /askedStop\?\.cancel/, "طلبُ الإيقاف غيرُ مفحوصٍ قبل المرحلة الثانية");
  });

  test("زرُّ الإيقاف لا يرفع رايةً لميّتٍ لا يقرؤها", () => {
    const api = read("src/app/api/offices/[id]/sync/route.ts");
    // القراءةُ تحصد المنقطعةَ سلفاً، فحين تصل هذه السطورُ تكون «الجارية» حيّةً بنبضها
    assert.match(api, /getManualSyncStatus\(g\.towerId\)/, "الإيقافُ لا يقرأ الحالةَ المحصودة");
    assert.match(api, /st\.state !== "running"/, "الإيقافُ يرفع رايةً بلا فحصِ الجريان");
  });
});
