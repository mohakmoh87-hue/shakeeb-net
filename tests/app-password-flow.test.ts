import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SET = "src/app/api/app/password/route.ts";
const LOGIN = "src/app/api/app/login/route.ts";
const FLOW = "../kabina-diag/app/lib/sub/screens_flow.dart";

describe("رمزُ واتساب يضبط كلمةَ المرور ولا يفتح التطبيق", () => {
  // 🔑 قرارُ محمد 2026-10-24: «عند إدخال الرمز يجب أن تفتح صفحةٌ لإدخال الرمز الجديد
  //    وإعادة كتابته، وعند إدخالهما يحوّلني إلى صفحة تسجيل الدخول مرّةً أخرى».
  test("ضبطُ الكلمة يحتاج جلسةً (لا يُضبَط لأحدٍ إلّا بجلسته)", () => {
    const src = read(SET);
    const sess = src.indexOf("getSubscriberSession()");
    const write = src.indexOf("subscriber.update");
    assert.ok(sess > 0 && write > sess, "التحقّقُ من الجلسة يسبق الكتابة");
    assert.ok(src.includes("where: { id: sub.id }"), "تُكتَب لصاحب الجلسة وحدَه");
    assert.ok(!/body\?\.(subscriberId|phone)/.test(src), "لا يُقبَل مشتركٌ من الطلب");
  });

  test("الجلسةُ تُبطَل بعد الحفظ — فيعود المشترك لشاشة الدخول", () => {
    const src = read(SET);
    const write = src.indexOf("subscriber.update");
    const clear = src.indexOf("clearSubscriberSession()");
    assert.ok(clear > write, "الإبطالُ بعد الحفظ لا قبلَه");
  });

  test("الكلمةُ تُجزَّأ ولا تُخزَّن نصّاً، والتطابقُ شرط", () => {
    const src = read(SET);
    assert.ok(src.includes("hashPassword(password)"), "تُجزَّأ قبل الحفظ");
    assert.ok(!/appPasswordHash: password\b/.test(src), "لا تُخزَّن نصّاً");
    assert.ok(src.includes("confirm !== password"), "الكلمتان يجب أن تتطابقا");
    assert.ok(src.includes("MIN_APP_PASSWORD"), "حدٌّ أدنى للطول");
  });

  test("المحظورُ لا يضبط كلمةَ مرور", () => {
    assert.ok(read(SET).includes("appBanned"), "حارسُ الحظر");
  });

  test("دخولُ كلمةِ المرور لم يُمَسّ", () => {
    const src = read(LOGIN);
    assert.ok(src.includes("verifyPassword(password, row.appPasswordHash)"), "التحقّقُ كما كان");
    assert.ok(src.includes('status: "no_password"'), "حالةُ من لا كلمةَ له كما كانت");
  });

  test("التطبيقُ لا يُفتَح بعد الرمز — بل شاشةُ ضبط الكلمة", () => {
    let flow: string;
    try { flow = read(FLOW); } catch { return; } // مستودعُ فلتر قد لا يكون بجانبنا
    const otp = flow.slice(flow.indexOf("Future<void> submitOtp()"), flow.indexOf("Future<void> submitNewPassword()"));
    assert.ok(otp.includes("toStep('lsSetPass')"), "الرمزُ يقود لشاشة ضبط الكلمة");
    assert.ok(!otp.includes("widget.s.login("), "ولا يفتح التطبيقَ مباشرةً");
    const set = flow.slice(flow.indexOf("Future<void> submitNewPassword()"));
    assert.ok(set.includes("toStep('ls0')"), "بعد الحفظ يعود لشاشة الدخول");
  });
});
