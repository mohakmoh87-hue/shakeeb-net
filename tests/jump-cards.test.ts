import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { jumpCards, type SasActivation } from "@/lib/sas4";

// ═════ 🎴 كلُّ كارتٍ تفعيلٌ — ولو وقعت ثلاثةٌ في ثانيةٍ واحدة (بلاغُ محمد 2026-11-01) ═════
//
// قياسُ كاسبر للشهر العاشر بعد إصلاح إزاحة التوقيت: صفوفُنا ١١٣٢ = **دفعاتُ** الساس (١١٢٥)
// لا كروتُه (١٤٠٠)، والفرقُ ٢٧٥ كارتاً — وهو بعينه عددُ «الكروت الزائدة في الدفعات» في
// ملفَّي الساس. والسبب: `classifyDateJump` كان يكتب صفّاً واحداً (`hit`) للوثبة كلِّها،
// فدفعةُ ثلاثةِ أشهرٍ (ثلاثةُ كروتٍ بفارق ٧ ثوانٍ) تُحسَب شهراً واحداً.

const HOUR = 3600_000;
const TOL = 12 * HOUR;
const mk = (createdAt: string, oldExpiration: string, newExpiration: string, price = 30000): SasActivation => ({
  sasUserId: 361133, username: "bg-19-23-7@amr", name: "اختبار", pin: null, method: "user_credit",
  oldExpiration, newExpiration, managerUsername: "FDT19-AMR", createdAt, price,
});

// دفعةُ ثلاثةِ أشهرٍ حقيقيّةٌ من ملفّ الساس (bg-19-23-7@amr، ٣٠ تشرين الأوّل)
const BATCH = [
  mk("2026-10-30 16:15:30", "2026-12-30 16:15:15", "2027-01-30 16:15:15"),
  mk("2026-10-30 16:15:23", "2026-11-30 16:15:15", "2026-12-30 16:15:15"),
  mk("2026-10-30 16:15:15", "2026-10-28 17:00:00", "2026-11-30 16:15:15"),
];

describe("🎴 كروتُ الوثبة", () => {
  test("دفعةُ ثلاثةِ أشهرٍ = ثلاثةُ كروتٍ مرتَّبةٍ بالأقدم", () => {
    const got = jumpCards(BATCH, new Date("2026-10-28T17:00:00Z"), new Date("2027-01-30T16:15:15Z"), TOL);
    assert.equal(got.length, 3, "الدفعةُ طُويت إلى صفٍّ واحد");
    assert.deepEqual(got.map((c) => c.createdAt), [
      "2026-10-30 16:15:15", "2026-10-30 16:15:23", "2026-10-30 16:15:30",
    ], "الترتيبُ ليس بالأقدم");
  });

  test("ما غطّاه تاريخُنا سلفاً لا يُعاد عدُّه", () => {
    // تاريخُنا يغطّي أوّلَ كارتَين ⇒ الثالثُ وحدَه جديد
    const got = jumpCards(BATCH, new Date("2026-12-30T16:15:15Z"), new Date("2027-01-30T16:15:15Z"), TOL);
    assert.deepEqual(got.map((c) => c.newExpiration), ["2027-01-30 16:15:15"]);
  });

  test("وسماحيّةُ الـ١٢ ساعةً تمنع عدَّ الكارت الذي أنتج تاريخَنا", () => {
    const got = jumpCards(BATCH, new Date("2026-11-30T22:00:00Z"), new Date("2027-01-30T16:15:15Z"), TOL);
    assert.deepEqual(got.map((c) => c.newExpiration), ["2026-12-30 16:15:15", "2027-01-30 16:15:15"]);
  });

  test("ولا يُحتسَب ما بعد انتهاءِ الساس الحاليّ (كارتٌ طرأ بعد قراءتنا)", () => {
    const got = jumpCards(BATCH, new Date("2026-10-28T17:00:00Z"), new Date("2026-11-30T16:15:15Z"), TOL);
    assert.deepEqual(got.map((c) => c.newExpiration), ["2026-11-30 16:15:15"]);
  });

  test("بلا تاريخٍ مخزَّنٍ عندنا تُحتسَب كلُّها، وبلا كروتٍ يعود فارغاً", () => {
    assert.equal(jumpCards(BATCH, null, new Date("2027-01-30T16:15:15Z"), TOL).length, 3);
    assert.equal(jumpCards([], new Date(), new Date(), TOL).length, 0);
  });

  test("🔒 لا تُسقِط كارتاً بلا تاريخِ انتهاءٍ أو بلا وقتٍ (لا حكمَ على ناقص)", () => {
    const broken = [mk("", "2026-10-28 17:00:00", "2026-11-30 16:15:15"), mk("2026-10-30 16:15:15", "2026-10-28 17:00:00", "")];
    assert.equal(jumpCards(broken, new Date("2026-10-28T17:00:00Z"), new Date("2026-11-30T16:15:15Z"), TOL).length, 0);
  });
});

describe("🛡️ المُصنِّفُ يكتب صفّاً لكلّ كارت", () => {
  const SYNC = () => fs.readFileSync(path.join(process.cwd(), "src/lib/subscriptionSync.ts"), "utf8");

  test("كروتُ الوثبة تُحسَب، ويُرتدّ إلى الكارت الواحد عند الشكّ", () => {
    const s = SYNC();
    assert.match(s, /const cards = jumpCards\(rows, sub\.dateTo, newSasExp, EXP_TOL_MS\);/, "المدى لا يُحسَب");
    assert.match(s, /const list = cards\.length \? cards : \[hit\];/, "لا ارتدادَ إلى السلوك القديم عند الفراغ");
    assert.match(s, /for \(const card of list\) \{/, "لا حلقةَ على الكروت");
    assert.ok(!/const evBase = \{\s*\n\s*agentId: office\.agentId \?\? -1, towerId: officeId, sasId, subscriberId: sub\.id,\s*\n\s*netUser: hit\.username/.test(s),
      "🔴 الصفُّ ما زال يُبنى من `hit` وحدَه ⇒ شهرٌ واحدٌ لدفعةِ ثلاثة");
  });

  test("🔑 وبوّابةُ «مقبوضٌ عندي» تُسأل مرّةً للوثبة كلِّها قبل الكتابة", () => {
    const s = SYNC();
    const i = s.indexOf("if (await collectedByUs(uKey, sub.id, hitAt,");
    const j = s.indexOf("const cards = jumpCards(");
    assert.ok(i > 0 && j > i, "البوّابةُ ليست قبل حلقة الكروت ⇒ وصلُنا لا يُسكِت الدفعة");
    assert.equal((s.match(/await collectedByUs\(uKey, sub\.id, hitAt,/g) ?? []).length, 1, "البوّابةُ تُسأل لكلّ كارت ⇒ نداءاتٌ مكرّرة");
  });

  test("ولا يُصنَّف شيءٌ إن كانت كلُّ كروت الوثبة مُغلَقةً سلفاً", () => {
    assert.match(SYNC(), /if \(!anyOpen && !anyLoan\) return false;/, "الوثبةُ المُغلَقةُ تُعتبَر مصنَّفةً فيضيع فرقُ التاريخ");
  });
});
