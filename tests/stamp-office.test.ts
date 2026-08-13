import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { techEffectiveOffices } from "../src/lib/field";
import { distanceMeters } from "../src/lib/attendance";
import { decideStampOffice, fallbackOffice, type StampOffice } from "../src/app/api/_lib/stampOffice";

// ===== أ-١٠ · مكتبُ البصمة يُحسم من موقعه الفعليّ =====
// القاعدةُ الحاكمة (قرار محمد 2026-08-11): «يستطيع بصمَ دخولٍ من مكتبٍ والخروجَ من مكتبٍ آخر،
// **وكلُّ الإجراءات ترجع إلى مكتبه الأصليّ وكأنّه بصم من مكتبه الأصليّ**.»
//
// ⚠️ ولماذا اختبارٌ هنا بالذات: **هذه المنطقةُ تُسقط أيّامَ راتب**. فمنعُ بصمةٍ ظلماً = لا صفَّ
// حضورٍ = **لا يومَ راتبٍ للفنيّ**، وهو ضررٌ صامتٌ لا يشتكي منه البرنامجُ بشيء. والعلّةُ التي
// أُصلحت كانت **سطراً واحداً** (`supportTowerId ?? towerId`) يتجاهل `supportKind`.
//
// و`resolveStampOffice` في المسار تقرأ القاعدةَ فلا تُختبَر بلا قاعدة؛ فالمُختبَرُ هنا
// **منطقُها الخالص**: مجموعةُ المكاتب المسموحة، والافتراضيُّ حسب نوع الدعم، وقرارُ النطاق.

// ── تُستدعى الدالّةُ **الحقيقيّة** لا نسخةٌ منها ──
// (اصطاد التدقيقُ العدائيُّ أنّ الاختبارَ كان **ينسخ** المنطق: فلو انحرف المسارُ عن الاختبار
//  لم يفشل شيءٌ، فصار الاختبارُ يوثّق ولا يحرس. ولذلك استُخرج القرارُ إلى دالّةٍ نقيّة.)
type Office = StampOffice;
type Tech = { towerId: number | null; supportTowerId: number | null; supportKind: string | null; extraTowerIds: string | null };

function resolve(t: Tech, offices: Office[], lat?: number, lng?: number): { office: number | null; blocked: boolean } {
  const fallback = fallbackOffice(t, t.towerId);
  const allowed = techEffectiveOffices({ towerId: t.towerId, supportTowerId: t.supportTowerId, extraTowerIds: t.extraTowerIds });
  const mine = offices.filter((o) => allowed.includes(o.id)); // ما يفعله الخادمُ بالترشيح
  const r = decideStampOffice(mine, fallback, lat, lng);
  return { office: r.office, blocked: !!r.error };
}

// مكتبان حقيقيّان من الإنتاج (نطاقٌ مُفعَّلٌ ٥٠ م) وثالثٌ بلا نطاق
const A: Office = { id: 7, name: "المواصلات", geoEnabled: true, lat: 33.3, lng: 44.4, geoRadius: 50 };
const B: Office = { id: 5, name: "الرسالة", geoEnabled: true, lat: 33.4, lng: 44.5, geoRadius: 50 };
const C: Office = { id: 41, name: "الشدن", geoEnabled: false, lat: null, lng: null, geoRadius: 200 };
const ALL = [A, B, C];
const atA = { lat: 33.3, lng: 44.4 };
const atB = { lat: 33.4, lng: 44.5 };
const far = { lat: 30.0, lng: 40.0 };

const tech = (o: Partial<Tech> = {}): Tech =>
  ({ towerId: A.id, supportTowerId: null, supportKind: null, extraTowerIds: null, ...o });

describe("أ-١٠ · مجموعةُ المكاتب المسموحة", () => {
  it("بلا دعمٍ ولا إضافات ⇒ مكتبُه وحدَه", () => {
    assert.deepEqual(techEffectiveOffices({ towerId: 7, supportTowerId: null, extraTowerIds: null }), [7]);
  });
  it("الدعمُ يُضاف ولا يُقصي مكتبَه — وهذا لبُّ العلّة", () => {
    assert.deepEqual(techEffectiveOffices({ towerId: 7, supportTowerId: 5, extraTowerIds: null }), [7, 5]);
  });
  it("لا تكرارَ لو كان الدعمُ مكتبَه نفسَه", () => {
    assert.deepEqual(techEffectiveOffices({ towerId: 7, supportTowerId: 7, extraTowerIds: null }), [7]);
  });
});

describe("أ-١٠ · 🔴 العلّةُ المُصلَحة: دعمُ «بطاقاتٍ محدّدة» لا يُخرجه من مكتبه", () => {
  it("على دعمِ بطاقاتٍ وهو في مكتبه ⇒ يُسمَح ويُنسَب لمكتبه (كان يُمنَع)", () => {
    const r = resolve(tech({ supportTowerId: B.id, supportKind: "cards" }), ALL, atA.lat, atA.lng);
    assert.equal(r.blocked, false, "المنعُ هنا كان يُسقط يومَ راتبٍ كاملاً");
    assert.equal(r.office, A.id);
  });
  it("والسلوكُ القديم كان يقيس على مكتب الدعم وحدَه ⇒ منعٌ", () => {
    // مُحاكاةُ السطر القديم: stampOffice = supportTowerId ?? towerId  ثمّ فحصُ ذلك المكتب وحدَه
    const oldStamp = B.id;
    const o = ALL.find((x) => x.id === oldStamp) as Office;
    const dist = distanceMeters(o.lat as number, o.lng as number, atA.lat, atA.lng);
    assert.ok(dist > (o.geoRadius ?? 200), "توثيقُ العلّة: وهو في مكتبه لكنّه بعيدٌ عن مكتب الدعم");
  });
  it("على دعمِ يومٍ كامل وهو في مكتب الدعم ⇒ يُسمَح ويُنسَب مكانُه لمكتب الدعم", () => {
    const r = resolve(tech({ supportTowerId: B.id, supportKind: "day" }), ALL, atB.lat, atB.lng);
    assert.equal(r.blocked, false);
    assert.equal(r.office, B.id);
  });
  it("على دعمِ يومٍ كامل لكنّه ما زال في مكتبه ⇒ يُسمَح أيضاً (لا يُحبَس)", () => {
    const r = resolve(tech({ supportTowerId: B.id, supportKind: "day" }), ALL, atA.lat, atA.lng);
    assert.equal(r.blocked, false);
    assert.equal(r.office, A.id, "الموقعُ هو الحُكم لا الإسناد");
  });
});

describe("أ-١٠ · قرارُ النطاق الجغرافيّ", () => {
  it("بعيدٌ عن كلّ مكاتبه المُفعَّلة ⇒ يُمنَع (والمنعُ يبقى كما كان)", () => {
    const r = resolve(tech({ supportTowerId: B.id, supportKind: "cards" }), ALL, far.lat, far.lng);
    assert.equal(r.blocked, true);
  });
  it("بلا إحداثيّاتٍ ومكتبُه مُفعَّلُ النطاق ⇒ يُمنَع (كما اليوم)", () => {
    const r = resolve(tech(), ALL);
    assert.equal(r.blocked, true);
  });
  it("مكتبُه بلا نطاقٍ ⇒ لا تحقّقَ إطلاقاً، بلا إحداثيّاتٍ أيضاً (كما اليوم)", () => {
    const r = resolve(tech({ towerId: C.id }), ALL);
    assert.equal(r.blocked, false);
    assert.equal(r.office, C.id);
  });
  it("الأقربُ يفوز حين يكون داخلَ نطاقَين متجاورَين", () => {
    const near1: Office = { ...A, geoRadius: 100000 };
    const near2: Office = { ...B, geoRadius: 100000 };
    const r = resolve(tech({ supportTowerId: B.id, supportKind: "day" }), [near1, near2], atB.lat, atB.lng);
    assert.equal(r.office, B.id, "هو عند B فيجب أن يُحسم B لا A");
  });
  it("🔴 **العلّةُ التي اصطادها التدقيقُ العدائيّ**: بلا GPS ومكتبُه بلا نطاقٍ ودعمُه مُفعَّل ⇒ يُسمَح", () => {
    // كان ترتيبُ القرارات يطلب الـGPS **قبل** بوّابة «الافتراضيُّ بلا نطاق»، فمَن مكتبُه
    // بلا نطاقٍ ثمّ أُسند له دعمٌ في مكتبٍ مُفعَّلٍ كان **يُمنَع بلا إحداثيّات** — وهو في
    // مكتبه الذي لا قيدَ عليه أصلاً. فيُعاد عينُ الضرر الذي وُلد البندُ لإصلاحه.
    const r = resolve({ towerId: C.id, supportTowerId: A.id, supportKind: "cards", extraTowerIds: null }, ALL);
    assert.equal(r.blocked, false, "طلبُ GPS هنا يُسقط يومَ راتبٍ بلا سببٍ — مكتبُه بلا نطاق");
    assert.equal(r.office, C.id);
  });
  it("ويبقى المنعُ صحيحاً بلا GPS إن كان مكتبُه **هو** المُفعَّل", () => {
    const r = resolve(tech({ supportTowerId: C.id, supportKind: "cards" }), ALL);
    assert.equal(r.blocked, true, "مكتبُه A مُفعَّلٌ ⇒ الـGPS شرطٌ فعليّ");
  });
  it("🛡️ ولا تضييقَ جديد: بعيدٌ، ومكتبُه الافتراضيُّ **بلا نطاق** ⇒ يُسمَح (كما اليوم)", () => {
    // مكتبُه C بلا نطاق، وله دعمُ بطاقاتٍ في A المُفعَّل. الافتراضيُّ C ⇒ لا قيدَ عليه.
    const r = resolve({ towerId: C.id, supportTowerId: A.id, supportKind: "cards", extraTowerIds: null }, ALL, far.lat, far.lng);
    assert.equal(r.blocked, false, "منعُه هنا يكون تضييقاً لم يكن موجوداً — وهو يُسقط يوم راتب");
    assert.equal(r.office, C.id);
  });
});

// ═══════════════ أ-١١ · المكاتبُ الإضافيّةُ الدائمة ═══════════════
// نصُّ محمد: «في إعدادات الفنيّ يُختار مكتبُه + مكاتبُ أخرى (صحٌّ لكلّ مكتب)، **دائمٌ ما لم
// يُزَل الصحّ**، فيبصم في **كلّ** تلك المكاتب. وإذا تغيّر مكتبُه الأصليُّ ⇒ بصمتُه تنتقل
// إلى المكتب الجديد.»
//
// والحقلُ `extraTowerIds` كان موجوداً والواجهةُ مبنيّةً والعزلُ مفروضاً في المسار — **ومسارُ
// البصمة وحدَه لا يعرفه**، وأُكمل في أ-١٠. فهذه الاختباراتُ تُثبت أنّ الإشارةَ تُبيح البصمَ
// فعلاً، وتحرس ألّا تعود البصمةُ عمياءَ عنها.
describe("أ-١١ · المكاتبُ الإضافيّةُ تُبيح البصمَ فيها", () => {
  const withExtra = (ids: number[]) =>
    ({ towerId: A.id, supportTowerId: null, supportKind: null, extraTowerIds: JSON.stringify(ids) });

  it("مكتبٌ إضافيٌّ يدخل مجموعةَ المكاتب المسموحة", () => {
    assert.deepEqual(techEffectiveOffices({ towerId: 7, supportTowerId: null, extraTowerIds: "[5,41]" }), [7, 5, 41]);
  });

  it("🎯 واقفٌ في مكتبٍ **إضافيٍّ** ⇒ يُسمَح ويُحسَم له (وهذا لبُّ أ-١١)", () => {
    const r = resolve(withExtra([B.id]), ALL, atB.lat, atB.lng);
    assert.equal(r.blocked, false);
    assert.equal(r.office, B.id, "بصم في المكتب الإضافيّ فيُسجَّل مكانُه فيه");
  });

  it("وبلا الإشارةِ يُمنَع — فالإشارةُ هي الإذن", () => {
    const r = resolve(tech(), ALL, atB.lat, atB.lng); // بلا مكاتبَ إضافيّة
    assert.equal(r.blocked, true, "B ليس من مكاتبه فلا يُبصَم عليه");
  });

  it("وما زال يبصم في مكتبه الأصليّ كما كان", () => {
    const r = resolve(withExtra([B.id]), ALL, atA.lat, atA.lng);
    assert.equal(r.office, A.id);
  });

  it("قائمةٌ فاسدةٌ أو فارغةٌ لا تكسر شيئاً", () => {
    for (const bad of ["[]", "", "null", "لا شيء", "[\"x\"]"]) {
      const r = resolve({ towerId: A.id, supportTowerId: null, supportKind: null, extraTowerIds: bad }, ALL, atA.lat, atA.lng);
      assert.equal(r.office, A.id, `القيمة ${JSON.stringify(bad)} يجب أن تُهمَل بلا عطل`);
    }
  });

  it("«إذا تغيّر مكتبُه الأصليُّ فبصمتُه تنتقل» — الافتراضيُّ يتبع مكتبَه لا قائمةً محفوظة", () => {
    // نُقل من A إلى C: الافتراضيُّ صار C، وA بقي إضافيّاً
    const moved = { towerId: C.id, supportTowerId: null, supportKind: null, extraTowerIds: JSON.stringify([A.id]) };
    assert.equal(fallbackOffice(moved, moved.towerId), C.id);
    const r = resolve(moved, ALL, atA.lat, atA.lng);
    assert.equal(r.office, A.id, "وهو واقفٌ في A الإضافيّ فيُسجَّل مكانُه فيه");
  });

  it("🛡️ ومكتبٌ إضافيٌّ بلا موقعٍ لا يُفلِت من النطاق: الافتراضيُّ مُفعَّلٌ ⇒ المنعُ قائم", () => {
    // C بلا موقع، ومكتبُه A مُفعَّل. فلو كان مكتبٌ بلا موقعٍ يُلغي التحقّق لبصم من بيته.
    const r = resolve(withExtra([C.id]), ALL, far.lat, far.lng);
    assert.equal(r.blocked, true, "لا يجوز أن يُلغيَ مكتبٌ بلا موقعٍ نطاقَ مكتبه الأصليّ");
  });

  it("ورسالةُ المنع تُرشد إلى المكتب الذي لا موقعَ له — فلا يظنّ العطلَ في هاتفه", () => {
    const mine = ALL.filter((o) => [A.id, C.id].includes(o.id));
    const r = decideStampOffice(mine, A.id, far.lat, far.lng);
    assert.ok(r.error, "يُمنَع");
    assert.ok(r.error?.includes("الشدن"), "يجب أن تُسمّى «الشدن» بلا موقعٍ محدَّد");
    assert.ok(r.error?.includes("أبلِغ المدير"), "وأن يُقال له ما يفعل");
  });
});

describe("أ-١٠ · العزل: لا يُبصَم على مكتبٍ ليس من مكاتبه", () => {
  it("مكتبٌ ليس في مجموعته لا يُحسَم له ولو كان واقفاً فيه", () => {
    const D: Office = { id: 99, name: "وكيلٌ آخر", geoEnabled: true, lat: 30.0, lng: 40.0, geoRadius: 50 };
    // هو واقفٌ في D بالضبط، وD ليس من مكاتبه ⇒ لا يُحسَم له، ويُمنَع لبُعده عن مكاتبه
    const r = resolve(tech(), [...ALL, D], D.lat as number, D.lng as number);
    assert.notEqual(r.office, D.id);
    assert.equal(r.blocked, true);
  });
});
