import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { identityOf, publicIdentity, defaultAvatar } from "../src/lib/market";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const MKT = "src/app/api/app/market/route.ts";
const CMT = "src/app/api/app/market/comments/route.ts";
const ADM = "src/app/api/app-admin/market/route.ts";
const POP = "src/app/api/app/popups/route.ts";
const APOP = "src/app/api/app-admin/popups/route.ts";

const SUB = { name: "صابرين عيسى عمران", netUser: "sab@kab", appNickname: "أمّ أحمد", appPhoto: "data:image/png;x" };

describe("🪪 هويّةُ المشترك: المستعارُ للجميع والحقيقيُّ للمدير وحدَه", () => {
  test("غيرُ المدير لا يرى اسماً حقيقيّاً ولا يوزر — أبداً", () => {
    const pub = identityOf(SUB, null, false);
    assert.equal(pub.sellerName, "أمّ أحمد");
    assert.equal(pub.realName, undefined, "لا اسمَ حقيقيّاً لغير المدير");
    assert.equal(pub.netUser, undefined, "ولا يوزر");
    assert.equal(pub.sellerPhoto, SUB.appPhoto, "وصورتُه تظهر للجميع");
    // ⚠️ المفتاحُ `sellerPhoto` لا `photo` — فصفُّ الإعلان فيه `photo` لصورة السلعة
    assert.ok(!("photo" in pub), "لا يصطدم بصورة الإعلان عند الدمج");
  });

  test("المديرُ يرى الاسمَ الكاملَ واليوزرَ مع الاسم المعروض", () => {
    const adm = identityOf(SUB, null, true);
    assert.equal(adm.sellerName, "أمّ أحمد");
    assert.equal(adm.realName, "صابرين عيسى عمران");
    assert.equal(adm.netUser, "sab@kab");
  });

  test("بلا اسمٍ مستعارٍ يظهر الاسمُ الكاملُ للجميع (قرارُ محمد)", () => {
    const p = identityOf({ name: "حسين علي", netUser: "h@kab" }, null, false);
    assert.equal(p.sellerName, "حسين علي");
  });

  test("الأيقونةُ الافتراضيّة: الملتبسُ محايدٌ عمداً لا مخمَّن", () => {
    assert.equal(defaultAvatar("صابرين عيسى"), "f");
    assert.equal(defaultAvatar("فاطمة"), "f");
    assert.equal(defaultAvatar("أبو أحمد"), "m");
    assert.equal(defaultAvatar("سجاد كريم"), "n", "اسمٌ لا يُعرف جنسُه ⇒ محايد");
    assert.equal(defaultAvatar(""), "n");
    assert.equal(defaultAvatar(null), "n");
  });

  test("حزمةُ العرض العامّة لا تحمل حقولَ الهويّة إطلاقاً", () => {
    const keys = Object.keys(publicIdentity(SUB, null)).sort();
    assert.deepEqual(keys, ["avatar", "name", "photo"]);
  });

  test("🔒 المديرُ يُحسَم بكوكي الخادم لا بعلَمٍ من العميل", () => {
    for (const p of [MKT, CMT, ADM]) {
      const src = read(p);
      assert.ok(src.includes("getAppAdminSession()"), `${p}: جلسةُ الأدمن من الكوكي`);
      assert.ok(!/isAdmin\s*=\s*(b|body|sp|url|searchParams)/.test(src), `${p}: لا يُقرأ isAdmin من الطلب`);
    }
  });
});

describe("⏳ موافقةُ الإعلانات", () => {
  test("الإعلانُ الجديد ينتظر الموافقة", () => {
    const src = read(MKT);
    assert.ok(src.includes('status: "pending"'), "النشرُ يضع pending");
    assert.ok(!/status:\s*"visible"[\s\S]{0,80}marketListing\.create/.test(src), "ولا ينشر فوراً");
  });

  test("والمشترِي لا يرى إلّا الظاهر — لا المنتظرَ ولا المخفيّ", () => {
    const src = read(MKT);
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    assert.ok(get.includes('{ status: "visible" }'), "القراءةُ العامّةُ محصورةٌ بـvisible");
  });

  test("المديرُ يصفّي المنتظرَ ويعدّه", () => {
    const src = read(ADM);
    assert.ok(src.includes('sp.get("only") === "pending"'), "مرشّحُ المنتظر");
    assert.ok(src.includes('status: "pending"'), "وعدّادُه");
    assert.ok(src.includes('["visible", "hidden", "pending"].includes'), "والموافقةُ تحويلٌ إلى visible");
  });
});

describe("🪟 النوافذُ المنبثقة", () => {
  test("الجمهورُ يُحسَم في الخادم من وجود جلسة المشترك", () => {
    const src = read(POP);
    assert.ok(src.includes('audience: { in: ["all", audience] }'), "المشتركُ نوافذَه والزائرُ نوافذَه");
    // 🔓 2026-10-27: الصنفُ من **حالة الاشتراك** لا من وجود الجلسة — وإلّا أخذ المنتهي
    //    منذ سنةٍ إعلاناتَ المشتركين، وقاعدةُ محمد: الثلاثةُ معاملةٌ واحدة.
    assert.ok(src.includes("appAudience()"), "والصنفُ من appAudience");
    assert.ok(!/searchParams|body/.test(src), "ولا يُقبَل جمهورٌ من الطلب");
    assert.ok(src.includes('status: "visible"') && src.includes("isDeleted: false"), "المخفيُّ والمؤرشَفُ لا يظهران");
  });

  test("صنفُ الجمهور: المنتهي أكثرَ من شهرٍ زائرٌ", () => {
    const src = read("src/lib/subscriberAuth.ts");
    assert.ok(src.includes("export async function appAudience()"), "الدالّةُ موجودة");
    assert.ok(src.includes("subscriberState("), "والحدُّ من الخادم (GRACE_DAYS) لا رقمٌ مكرّر");
    assert.ok(/st\.state === "expired" \? "sub_expired" : "sub_active"/.test(src), "المنتهي أكثرَ من شهرٍ ليس مشتركاً فعّالاً");
    assert.ok(/c\.klass === "sub_active" \? "subs" : "guests"/.test(src), "والاختزالُ الثنائيُّ: الفعّالُ وحدَه subs");
    // 🔑 مصدرُ حقيقةٍ واحد: `appAudience` مشتقّةٌ من `appClass` لا حسابٌ موازٍ يتفرّع عنها
    assert.ok(src.includes("const c = await appClass();"), "appAudience مشتقّةٌ من appClass");
  });

  test("إدارتُها لأدمن التطبيق وحدَه، ولا حذفَ نهائيّ", () => {
    const src = read(APOP);
    assert.equal((src.match(/guardAdmin\(\)/g) ?? []).length >= 4, true, "كلُّ فعلٍ محروس");
    assert.ok(src.includes("getAppAdminSession()"), "بالكوكي");
    assert.ok(!/appPopup\.delete\b|deleteMany/.test(src), "لا حذفَ نهائيّ");
    assert.ok(src.includes("isDeleted: true"), "أرشفةٌ بعلَم");
    assert.ok(src.includes("cleanPhoto"), "الصورةُ تُنقّى");
  });
});
