import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { techEffectiveOffices } from "../src/lib/field";
import { distanceMeters } from "../src/lib/attendance";

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

// ── مُحاكاةُ منطقِ الحلّ حرفاً بحرف (نفسُ ترتيب القرارات في المسار) ──
type Office = { id: number; name: string; geoEnabled: boolean; lat: number | null; lng: number | null; geoRadius: number | null };
type Tech = { towerId: number | null; supportTowerId: number | null; supportKind: string | null; extraTowerIds: string | null };

function resolve(t: Tech, offices: Office[], lat?: number, lng?: number): { office: number | null; blocked: boolean } {
  const home = t.towerId;
  const fallback = t.supportKind === "day" && t.supportTowerId != null ? t.supportTowerId : home;
  const allowed = techEffectiveOffices({ towerId: home, supportTowerId: t.supportTowerId, extraTowerIds: t.extraTowerIds });
  if (!allowed.length) return { office: fallback, blocked: false };
  const mine = offices.filter((o) => allowed.includes(o.id));
  const fenced = mine.filter((o) => o.geoEnabled && o.lat != null && o.lng != null);
  if (!fenced.length) return { office: fallback, blocked: false };
  if (typeof lat !== "number" || typeof lng !== "number") return { office: null, blocked: true };
  const measured = fenced
    .map((o) => ({ o, dist: distanceMeters(o.lat as number, o.lng as number, lat, lng), radius: o.geoRadius ?? 200 }))
    .sort((a, b) => a.dist - b.dist);
  const inside = measured.filter((m) => m.dist <= m.radius);
  if (inside.length) return { office: inside[0].o.id, blocked: false };
  const fallbackFenced = fallback != null && fenced.some((o) => o.id === fallback);
  if (!fallbackFenced && fallback != null) return { office: fallback, blocked: false };
  return { office: null, blocked: true };
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
  it("🛡️ ولا تضييقَ جديد: بعيدٌ، ومكتبُه الافتراضيُّ **بلا نطاق** ⇒ يُسمَح (كما اليوم)", () => {
    // مكتبُه C بلا نطاق، وله دعمُ بطاقاتٍ في A المُفعَّل. الافتراضيُّ C ⇒ لا قيدَ عليه.
    const r = resolve({ towerId: C.id, supportTowerId: A.id, supportKind: "cards", extraTowerIds: null }, ALL, far.lat, far.lng);
    assert.equal(r.blocked, false, "منعُه هنا يكون تضييقاً لم يكن موجوداً — وهو يُسقط يوم راتب");
    assert.equal(r.office, C.id);
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
