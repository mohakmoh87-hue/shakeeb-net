import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 👤 حساباتُ التجريب 2026-11-04 — الحرّاسُ البنيويّون ═════
//
// حساباتٌ وهميّةٌ داخلَ مكتبٍ حقيقيّ: فالخطرُ ليس في الميزة بل في ما قد تمسّه. الحرّاسُ
// على ما لا يجوز أن ينكسر: لا جائزةَ فنيٍّ من دخولٍ تجريبيّ · لا ظهورَ في قوائم المكتب ·
// لا رسالةَ واتساب · لا عمودَ قاعدةٍ جديد · ولا رقمَ قد يكون لإنسان.

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const LIB = read("src/lib/appTestUsers.ts");
const LOGIN = read("src/app/api/app/login/route.ts");
const SUBS = read("src/app/api/subscribers/route.ts");
const QUERY = read("src/app/api/subscribers/query/route.ts");
const SCHEMA = read("prisma/schema.prisma");

describe("👤 حساباتُ التجريب", () => {
  test("السجلُّ في الإعدادات — لا جدولَ ولا عمودَ ولا لصقةَ SQL", () => {
    assert.match(LIB, /const KEY = "appTestUsers"/, "السجلُّ بلا مفتاحٍ مميَّز");
    assert.doesNotMatch(LIB, /ALTER TABLE|ADD COLUMN|CREATE TABLE/, "لصقةُ SQL في مسارِ ميزة");
    assert.doesNotMatch(SCHEMA, /appTestUser|isTestAccount/, "عمودٌ جديدٌ على القاعدة لأجل حساباتِ تجريب");
  });

  test("💰 لا جائزةَ «تنصيب التطبيق» من دخولٍ تجريبيّ", () => {
    const testPath = LOGIN.slice(LOGIN.indexOf("resolveTestUser(raw)"), LOGIN.indexOf('if (!core || !password)'));
    assert.ok(testPath.length > 200, "مسارُ التجريب غائبٌ عن مسار الدخول");
    assert.doesNotMatch(testPath, /markAppLogin/, "دخولٌ تجريبيٌّ يصنع مالاً لفنيّ");
    assert.match(LOGIN, /markAppLogin\(sub\.id\)/, "دخولُ المشترك الحقيقيّ فقد طابعَه وجائزتَه");
  });

  test("🔒 لا تظهر في قوائم مشتركي المكتب — وبسجلٍّ فارغٍ لا شرطَ يُضاف", () => {
    for (const [name, src] of [["المشتركون", SUBS], ["كلّ المشتركين", QUERY]] as const) {
      assert.match(src, /const hiddenTest = await testSubscriberIds\(\)/, `${name}: بلا استثناءٍ لحسابات التجريب`);
      assert.match(src, /hiddenTest\.length \? \{ id: \{ notIn: hiddenTest \} \} : \{\}/, `${name}: شرطٌ يُضاف بسجلٍّ فارغٍ ⇒ تغييرُ الاستعلام القديم`);
    }
  });

  test("📵 لا رسالةَ واتساب ولا دَينَ ولا رقمَ قد يكون لإنسان", () => {
    assert.match(LIB, /waEnabled: false/, "رسائلُ الانتهاء والديون تخرج لرقمٍ وهميّ");
    assert.match(LIB, /carry: 0/, "دَينٌ وهميٌّ يدخل تقاريرَ المكتب");
    for (const core of ["7000000001", "7000000002", "7000000003", "7000000004"]) {
      assert.ok(LIB.includes(core), `الرقمُ ${core} ليس من أرقام التجريب`);
    }
    assert.doesNotMatch(LIB, /"077|"078|"079|"075/, "رقمٌ ببادئةٍ مخصَّصةٍ لمشغّلٍ حقيقيّ ⇒ قد يكون لإنسان");
  });

  test("🛑 رقمٌ تجريبيٌّ يملكه صفٌّ ليس من السجلّ ⇒ توقّف", () => {
    assert.match(LIB, /clash\.some\(\(c\) => !mine\.has\(Number\(c\.id\)\)\)/, "المنشئُ يكتب فوق صفِّ إنسانٍ بلا فحص");
  });

  test("🗑️ الإيقافُ إخفاءٌ ناعمٌ لا حذف", () => {
    assert.match(LIB, /data: \{ isDeleted: true \}/, "الإيقافُ يمحو الصفوف");
    assert.doesNotMatch(LIB, /subscriber\.delete|deleteMany\(\{ where: \{ id/, "حذفٌ نهائيٌّ لمشترك");
  });
});
