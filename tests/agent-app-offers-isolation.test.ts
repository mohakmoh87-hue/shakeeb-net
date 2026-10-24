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
      assert.ok(src.includes("subscriberAgentId(sess.subscriberId)"), `${p}: الوكيلُ يُستنبَط من جلسة المشترك`);
      assert.ok(!/searchParams\.get\(["']agentId/.test(src), `${p}: لا يُقرأ agentId من الطلب`);
      assert.ok(!/body.*agentId/.test(src), `${p}: لا يُقرأ agentId من الجسم`);
      assert.ok(src.includes("getSubscriberSession"), `${p}: جلسةُ مشتركٍ إلزاميّة`);
      assert.ok(src.includes("appBanned"), `${p}: المحظورُ يُمنع`);
    }
  });

  test("العرضُ لا يصل مشتركاً إلّا إن كان لوكيله وهو في جمهوره المثبَّت", () => {
    const src = read(SUB_OFFERS);
    assert.ok(src.includes("agentOfferTarget.findMany"), "الجمهورُ يُقرأ من الجدول المثبَّت");
    assert.ok(src.includes("subscriberId: sess.subscriberId"), "الجمهورُ مقيَّدٌ بالمشترك نفسِه");
    // الاستعلامُ النهائيُّ يجمع: ضمن جمهوره + لوكيله + غيرُ محذوفٍ + ظاهر
    const q = src.slice(src.indexOf("agentOffer.findMany"), src.indexOf("return NextResponse.json({ packages, offers })"));
    for (const need of ["id: { in: offerIds }", "agentId", "isDeleted: false", 'status: "visible"']) {
      assert.ok(q.includes(need), `شرطُ ${need} غائبٌ عن استعلام العروض`);
    }
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
