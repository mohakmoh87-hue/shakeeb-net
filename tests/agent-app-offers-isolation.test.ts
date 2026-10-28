import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { targetWindow } from "../src/lib/agentAppOffers";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SUB_OFFERS = "src/app/api/app/offers/route.ts";
const SUB_PKGS = "src/app/api/app/packages/route.ts";
const AGENT_OFFERS = "src/app/api/store/offers/route.ts";
const AGENT_PKGS = "src/app/api/store/app-packages/route.ts";

describe("عزلُ «الباقات والعروض» — المشتركُ لا يرى إلّا ما نشره وكيلُه له", () => {
  test("مسارا المشترك يستنبطان الوكيلَ من مكتبه ولا يقبلانه من الطلب", () => {
    for (const p of [SUB_OFFERS, SUB_PKGS]) {
      const src = read(p);
      assert.ok(/subscriberAgentId\((sess\.subscriberId|subscriberId)\)/.test(src), `${p}: الوكيلُ يُستنبَط من جلسة المشترك`);
      assert.ok(!/searchParams\.get\(["']agentId/.test(src), `${p}: لا يُقرأ agentId من الطلب`);
      assert.ok(!/body.*agentId/.test(src), `${p}: لا يُقرأ agentId من الجسم`);
      // الهويّةُ من الكوكي وحدَها: إمّا `getSubscriberSession` مباشرةً أو `appAudience`
      // التي تُناديها — ولا سبيلَ ثالثَ لتعريف المتصفّح.
      assert.ok(/getSubscriberSession|appAudience|appClass/.test(src), `${p}: الهويّةُ من الكوكي وحدَها`);
      assert.ok(src.includes("appBanned"), `${p}: المحظورُ يُمنع`);
    }
  });

  test("العرضُ لا يصل مشتركاً إلّا إن كان لوكيله وهو في جمهوره المثبَّت", () => {
    const src = read(SUB_OFFERS);
    const fn = src.slice(src.indexOf("async function visibleOffers"), src.indexOf("// بلا وكيل"));
    assert.ok(fn.includes("agentOfferTarget.findMany"), "الجمهورُ يُقرأ من الجدول المثبَّت");
    assert.ok(/where: \{ subscriberId \}/.test(fn), "الجمهورُ مقيَّدٌ بالمشترك نفسِه");
    assert.ok(fn.includes("agentId == null ? {} : { agentId }"), "وكيلُه وحدَه إن كان له وكيل");
    for (const need of ["...scope", "isDeleted: false", 'status: "visible"']) {
      assert.ok(fn.includes(need), `شرطُ ${need} غائبٌ عن استعلام العروض`);
    }
    // 🔑 القاعدةُ الحاكمةُ التي تُبقي كلَّ عرضٍ قديمٍ يعمل كما كان: ما له مجموعةٌ مثبَّتةٌ
    //    لا يراه إلّا من هو فيها — مهما كان صنفُه.
    assert.ok(fn.includes("o.targetCount > 0 ? mine.has(o.id) : true"), "المجموعةُ المثبَّتةُ حاكمةٌ حيث وُجدت");
    assert.ok(fn.includes("offerVisibleTo(o, klass, myPkg)"), "ثمّ الصنفُ والباقة");
  });

  test("جمهورُ العرض أربعةُ أصنافٍ لا غير، وترشيحُ الباقة للمشتركين وحدَهم", () => {
    const lib = read("src/lib/agentAppOffers.ts");
    assert.ok(lib.includes('["sub_active", "sub_expired", "account", "guest"]'), "الأصنافُ الأربعة");
    // 🔒 القيمُ القديمةُ تُوسَّع **بما يطابق سلوكَ الأمس**: فلا يتغيّر عرضٌ أُرسل قبل اليوم
    assert.ok(/subs: \["sub_active"\]/.test(lib), "subs ⇒ الفعّالُ وحدَه");
    assert.ok(/guests: \["sub_expired", "account", "guest"\]/.test(lib), "guests ⇒ الثلاثةُ الباقية");
    // وترشيحُ الباقة لا يُطبَّق على من لا باقةَ له، وإلّا اختفى عنه عرضٌ اختِير له
    const fn = lib.slice(lib.indexOf("export function offerVisibleTo"), lib.indexOf("// نافذةُ الاستهداف"));
    assert.ok(fn.includes("if (!isSub) return true;"), "الزائرُ لا يسقط بترشيح الباقة");
    assert.ok(fn.includes("if (!pkgs.length) return true;"), "وبلا ترشيحٍ يراه الجميع");
  });

  test("الوكيلُ يرسل بلا تاريخٍ فلا تُثبَّت مجموعة، وبتاريخٍ فتُثبَّت", () => {
    const src = read(AGENT_OFFERS);
    assert.ok(src.includes('cleanClasses(b?.audiences ?? b?.audience) || "sub_active"'), "الأصنافُ تُنقّى والافتراضُ الفعّال");
    assert.ok(src.includes("cleanPackageIds(b?.packageIds)"), "ومعرّفاتُ الباقات تُنقّى");
    const noWindow = src.slice(src.indexOf("if (!from && !to) {"), src.lastIndexOf("if (!DAY.test(from)"));
    assert.ok(noWindow.includes("targetCount: 0"), "بلا تاريخٍ لا مجموعة");
    assert.ok(!noWindow.includes("agentOfferTarget"), "ولا تثبيتَ أسماء");
    assert.ok(src.indexOf("agentOfferTarget.createMany") > src.lastIndexOf("if (!DAY.test(from)"), "التثبيتُ لمسار التاريخ وحدَه");
  });

  test("الباقةُ المنشورةُ تُقرأ بشرط الوكيل أيضاً — لا بالمعرّف وحدَه", () => {
    const src = read(SUB_OFFERS);
    const q = src.slice(src.indexOf("package.findMany"), src.indexOf("const meta ="));
    assert.ok(q.includes("id: { in: pkgIds }") && q.includes("agentId"), "باقاتُ الوكيل نفسِه حصراً");
  });

  test("مسارا الوكيل محروسان بـstore.manage وبوكيل الجلسة", () => {
    for (const p of [AGENT_OFFERS, AGENT_PKGS]) {
      const src = read(p);
      assert.ok(src.includes('guard("store.manage")'), `${p}: الحارس`);
      assert.ok(src.includes("g.session.agentId"), `${p}: الوكيلُ من الجلسة`);
    }
  });

  test("لا تُنشَر باقةُ وكيلٍ آخرَ — تحقّقُ ملكيّةٍ قبل الكتابة", () => {
    const src = read(AGENT_PKGS);
    const patch = src.slice(src.indexOf("export async function PATCH"));
    const own = patch.indexOf("package.findFirst");
    const write = patch.indexOf("agentAppPackage.upsert");
    assert.ok(own > 0 && write > own, "التحقّقُ من الملكيّة يسبق الكتابة");
    assert.ok(patch.slice(own, own + 200).includes("agentId"), "التحقّقُ بشرط الوكيل");
  });

  test("جمهورُ العرض من مكاتب الوكيل وحدَها، ولا يُقبَل معرّفٌ خارجَها", () => {
    const src = read(AGENT_OFFERS);
    assert.ok(src.includes("agentTowerIds(g.session)"), "المكاتبُ من الجلسة");
    assert.ok(src.includes("targetedSubscriberIds(towerIds"), "الجمهورُ من تلك المكاتب");
    // التحديدُ اليدويُّ يُرشِّح داخلَ الجمهور ولا يستبدله
    assert.ok(src.includes("ids = ids.filter((id) => picked.has(id))"), "الاختيارُ اليدويُّ يُقصَر على الجمهور");
  });

  test("لا حذفَ نهائيّ — العرضُ يُؤرشَف بـisDeleted", () => {
    const src = read(AGENT_OFFERS);
    assert.ok(!/agentOffer\.delete|deleteMany/.test(src), "لا حذفَ من جدول العروض");
    assert.ok(src.includes("isDeleted: true"), "الأرشفةُ بعلَم");
    assert.ok(!/export async function DELETE/.test(src), "لا مسارَ حذف");
  });

  test("نافذةُ الاستهداف تشمل يومَ النهاية كاملاً وترفض المقلوب", () => {
    const w = targetWindow("2026-11-01", "2026-11-30");
    assert.ok(w);
    assert.equal(w!.gte.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(w!.lte.toISOString(), "2026-11-30T23:59:59.999Z");
    assert.equal(targetWindow("2026-11-30", "2026-11-01"), null, "البدايةُ بعد النهاية تُرفض");
    assert.equal(targetWindow("سيء", "2026-11-01"), null, "تاريخٌ غيرُ صالحٍ يُرفض");
  });

  test("العرضُ يحتاج نصّاً أو صورة، والصورةُ تمرّ بمنقّي الصور", () => {
    const src = read(AGENT_OFFERS);
    assert.ok(src.includes("cleanPhoto(b?.image)"), "الصورةُ تُنقّى");
    assert.ok(src.includes("if (!text && !image)"), "لا عرضَ بلا نصٍّ ولا صورة");
  });
});
