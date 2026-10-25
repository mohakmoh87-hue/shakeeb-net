import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { displayName, MAX_COMMENT } from "../src/lib/market";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const CMT = "src/app/api/app/market/comments/route.ts";
const MKT = "src/app/api/app/market/route.ts";
const ME = "src/app/api/app/me/route.ts";

describe("الاسمُ المستعار وتعليقاتُ سوق المستعمل", () => {
  // 🔑 قرارُ محمد: «يظهر الاسمُ المستعار، وإن لم يُدخِل اسماً مستعاراً يظهر اسمُ المشترك»
  test("الاسمُ المعروض: المستعارُ ثمّ الاسمُ ثمّ اللقطة", () => {
    assert.equal(displayName({ appNickname: "أبو أحمد", name: "محمد علي" }), "أبو أحمد");
    assert.equal(displayName({ appNickname: "   ", name: "محمد علي" }), "محمد علي", "المستعارُ الفارغُ لا يحجب الاسم");
    assert.equal(displayName({ appNickname: null, name: null }, "لقطة"), "لقطة", "اللقطةُ ارتدادٌ إن ذهب الصفّ");
    assert.equal(displayName(null, null), "مشترك", "ولا يظهر فراغٌ أبداً");
    assert.equal(displayName({ appNickname: "  نور  ", name: "x" }), "نور", "تُقلَّم المسافات");
  });

  test("الاسمُ يُحَلُّ عند القراءة — فتتبعه الإعلاناتُ القديمة لا الجديدةُ وحدَها", () => {
    const src = read(MKT);
    // (صارت تمرّ بـidentityOf التي تلفّ displayName وتضيف الصورةَ وهويّةَ المدير)
    assert.ok(src.includes("identityOf(byId.get(i.sellerId), i.sellerName"), "القراءةُ تحلّ الاسم");
    assert.ok(src.includes("appNickname: true"), "المستعارُ يُجلَب مع البائع");
  });

  test("التعليقُ لا يُكتَب إلّا بجلسةِ مشتركٍ غيرِ محظور، وعلى إعلانٍ ظاهر", () => {
    const src = read(CMT);
    const post = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function DELETE"));
    assert.ok(post.includes("getSubscriberSession()"), "جلسةٌ إلزاميّة");
    assert.ok(post.includes("appBanned"), "المحظورُ ممنوع");
    assert.ok(post.includes('status: "visible"'), "الإعلانُ يجب أن يكون ظاهراً");
    assert.ok(post.includes("rateLimit("), "خانقٌ ضدّ الإغراق");
    assert.ok(post.includes(`slice(0, MAX_COMMENT)`), "سقفُ الطول");
    assert.ok(!/body\?\.subscriberId/.test(post), "لا يُقبَل كاتبٌ من الطلب");
  });

  test("الحذفُ ناعمٌ ولصاحب التعليق أو صاحب الإعلان وحدَهما", () => {
    const src = read(CMT);
    const del = src.slice(src.indexOf("export async function DELETE"));
    assert.ok(del.includes("row.subscriberId === sess.subscriberId"), "صاحبُ التعليق");
    assert.ok(del.includes("listing?.sellerId === sess.subscriberId"), "أو صاحبُ الإعلان");
    assert.ok(del.includes("isDeleted: true"), "حذفٌ ناعم");
    assert.ok(!/marketComment\.delete\b|deleteMany/.test(src), "ولا حذفَ نهائيّ في المسار كلِّه");
  });

  test("تعليقاتُ إعلانٍ مخفيٍّ لا تُقرأ", () => {
    const src = read(CMT);
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    assert.ok(get.includes('status: "visible"'), "الإعلانُ الظاهرُ شرطٌ للقراءة");
  });

  test("الاسمُ المستعار يُعدَّل بجلسة صاحبه وحدَه", () => {
    const src = read(ME);
    const patch = src.slice(src.indexOf("export async function PATCH"));
    assert.ok(patch.includes("getSubscriberSession()"), "جلسةٌ إلزاميّة");
    assert.ok(patch.includes("where: { id: sub.id }"), "يُكتَب لصاحب الجلسة");
    assert.ok(!/body.*subscriberId|params/.test(patch), "لا يُقبَل مشتركٌ من الطلب");
    assert.ok(patch.includes("appBanned"), "المحظورُ ممنوع");
    assert.ok(patch.includes("raw || null"), "الفراغُ يمحوه فيعود اسمُه");
  });

  test("سقفُ التعليق معقولٌ ومُعرَّفٌ مرّةً واحدة", () => {
    assert.ok(MAX_COMMENT >= 100 && MAX_COMMENT <= 1000, "سقفٌ معقول");
    assert.ok(read(CMT).includes("MAX_COMMENT"), "المسارُ يستعمل الثابتَ لا رقماً مكرّراً");
  });
});
