import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DIAG_BOOK, validateBook, type DiagBook, type DiagRecipe } from "../src/app/api/app/diag-recipes/book";
import { UI_ONLY, ALWAYS_RESTART } from "../src/lib/workerRestart";

// ═════ 🩺 كتابُ لهجات أجهزة البور — طلبُ محمد 2026-11-23 ═════
// «لا أريد أن أمسح وأنصّب برنامجاً جديداً مع كلّ فحصٍ خاطئٍ وتصحيحِه».
// فاللهجةُ صارت بياناتٍ على الخادم. وهذه الحرّاسُ تحمي الثمنَ المقابل: كتابٌ معطوبٌ
// يُنشَر فيُعطّل الفحصَ عند كلّ مشترك دفعةً واحدة، أو يُقدَّم لمن لا جلسةَ له.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const BOOK = "src/app/api/app/diag-recipes/book.ts";
const ROUTE = "src/app/api/app/diag-recipes/route.ts";

const clone = (): DiagBook => JSON.parse(JSON.stringify(DIAG_BOOK));

describe("الكتابُ المنشورُ نفسُه", () => {
  test("يمرّ بحارسه بلا ملاحظة", () => {
    assert.deepEqual(validateBook(DIAG_BOOK), []);
  });

  test("كلُّ وصفةٍ تحمل ما يكفي لتنفيذها بلا كودٍ مُضاف", () => {
    for (const r of DIAG_BOOK.recipes) {
      assert.ok(r.login.startsWith("/"), r.id);
      assert.ok(r.optic.startsWith("/"), r.id);
      assert.ok(r.form.includes("{user}"), r.id);
      assert.ok(r.user && r.pass, r.id);
    }
  });

  test("وصفةُ HS8546V موجودةٌ وبلا تعمية — وهي مقيسةٌ من كود صفحة دخوله", () => {
    const r = DIAG_BOOK.recipes.find((x) => x.model && new RegExp(x.model).test("HS8546V"));
    assert.ok(r, "لا وصفةَ تطابق HS8546V");
    assert.equal(r!.auth, "none");
    assert.equal(r!.jar["Cookie"], "body:Language:english:id=-1");
  });

  test("الوصفةُ العاملةُ على HS8145V5 و HG8245Q2 باقيةٌ كما كانت — لا تُكسَر لأجل الجديد", () => {
    const r = DIAG_BOOK.recipes.find((x) => x.id === "hw-md5sha");
    assert.ok(r, "اختفت وصفةُ md5+sha");
    assert.equal(r!.auth, "md5+sha");
    assert.equal(r!.form, "UserName={user}&PassWord={pass64}&x.X_HW_Token={token}");
    assert.equal(r!.optic, "/html/amp/opticinfo/opticinfo.asp");
    assert.equal(r!.token, "/asp/GetRandCount.asp");
    assert.equal(r!.jar["body:Language:english:id"], "-1");
  });

  test("وصفةٌ عامّةٌ بلا شرطِ طرازٍ موجودةٌ دائماً — فجهازٌ مجهولُ الطراز لا يبقى بلا محاولة", () => {
    assert.ok(DIAG_BOOK.recipes.some((r) => !r.model));
  });

  // 🔑 جهازٌ ثالثٌ يردّ رمزاً طولُه ٤٨ خانةً يسبقه BOM. تعبيرُ `{32}` كان يقتطع أوّلَ ٣٢
  //    فيرسل رمزاً مبتوراً ⇒ دخولٌ مرفوض. `{32,}` يأخذه كاملاً ويتخطّى الـBOM.
  test("تعبيرُ الرمز يقبل ٣٢ خانةً فأكثر ويتخطّى الـBOM — لا يبتر رمزاً طويلاً", () => {
    const r = DIAG_BOOK.recipes.find((x) => x.id === "hw-browser");
    assert.ok(r, "اختفت وصفةُ المتصفّح");
    assert.equal(r!.tokenRe, "[0-9a-fA-F]{32,}");
    const re = new RegExp(r!.tokenRe!);
    const token48 = "ea709371d6df7ce7114a3bea667bde081411c12f6e6d6746";
    assert.equal(re.exec("﻿" + token48)?.[0], token48, "يجب أن يأخذ الرمزَ كاملاً بعد الـBOM");
    assert.equal(re.exec("abcdef0123456789abcdef0123456789")?.[0]?.length, 32, "ويبقى الرمزُ القصيرُ ٣٢ كما كان");
  });

  // 🔒 لهجةٌ جديدةٌ تُضاف للأجهزة التي لا تُقرأ، فلا يجوز أن تسبق ما يُقرأ اليوم:
  //    الجهازُ العاملُ يرجع من إحدى هذه الخمس قبل أن يصل إلى أيّ وصفةٍ تالية.
  // 🔴 درسٌ من انكسارِ جهازٍ كان يقرأ: بعضُ الأجهزة يقفل الدخولَ بعد محاولةٍ فاشلة،
  //    فأوّلُ وصفةٍ يجب أن تكون `md5+sha` (الدفترُ القديمُ العاملُ بدأ بها). وضعُ `plain`
  //    أوّلاً هو ما كسر الجهاز. هذا الاختبارُ يمنع عودةَ الخطأ.
  test("أوّلُ وصفةٍ md5+sha — لا plain — كي لا تُقفِل محاولةٌ فاشلةٌ ما بعدها", () => {
    assert.equal(DIAG_BOOK.recipes[0].id, "hw-md5sha");
    assert.equal(DIAG_BOOK.recipes[0].auth, "md5+sha");
    const plain = DIAG_BOOK.recipes.findIndex((r) => r.id === "hw-plain");
    const md5sha = DIAG_BOOK.recipes.findIndex((r) => r.id === "hw-md5sha");
    assert.ok(md5sha < plain, "md5+sha يجب أن تسبق plain في الترتيب العامّ");
  });

  test("hw-plain تبقى مقيَّدةً بطراز HS8546 — فلا تسبق md5+sha إلّا على جهازها", () => {
    const r = DIAG_BOOK.recipes.find((x) => x.id === "hw-plain");
    assert.ok(r?.model && new RegExp(r.model).test("HS8546V"));
  });

  test("وصفةُ التشخيص لا تقرأ بوراً أبداً — تعبيرُها لا يطابق شيئاً", () => {
    const r = DIAG_BOOK.recipes.find((x) => x.id === "probe-session");
    assert.ok(r, "اختفت وصفةُ التشخيص");
    assert.equal(r!.optic, "/");
    assert.equal(new RegExp(r!.rx!).test("-19.36"), false);
  });
});

describe("حارسُ الكتاب يمسك ما يُعطّل الفحصَ عند الجميع", () => {
  const broken = (f: (b: DiagBook) => void): string[] => {
    const b = clone();
    f(b);
    return validateBook(b);
  };
  const first = (b: DiagBook): DiagRecipe => b.recipes[0];

  test("حقلٌ مفقودٌ يُرفَض", () => {
    for (const k of ["login", "optic", "user", "pass"] as const) {
      assert.ok(broken((b) => { (first(b) as Record<string, unknown>)[k] = ""; }).length > 0, k);
    }
  });

  test("تعميةٌ بلا مسار رمزٍ تُرفَض — لأنّ التعميةَ تخلط الرمزَ بالكلمة", () => {
    assert.ok(broken((b) => { first(b).auth = "md5+sha"; delete first(b).token; }).length > 0);
  });

  test("تعميةٌ مجهولةُ الاسم تُرفَض", () => {
    assert.ok(broken((b) => { (first(b) as Record<string, unknown>).auth = "sha512"; }).length > 0);
  });

  test("مسارٌ لا يبدأ بشرطةٍ يُرفَض", () => {
    assert.ok(broken((b) => { first(b).optic = "html/amp/opticinfo/opticinfo.asp"; }).length > 0);
  });

  test("نموذجٌ بلا {user} يُرفَض", () => {
    assert.ok(broken((b) => { first(b).form = "PassWord={pass64}"; }).length > 0);
  });

  test("تعبيرٌ نمطيٌّ غيرُ صالحٍ يُرفَض — في الطراز وفي قراءة الرقم", () => {
    assert.ok(broken((b) => { first(b).model = "HS85(46"; }).length > 0);
    assert.ok(broken((b) => { first(b).rx = "(-\d{1,2}"; }).length > 0);
  });

  test("معرّفٌ مكرّرٌ يُرفَض — وإلّا التبس السطرُ في السجلّ", () => {
    assert.ok(broken((b) => { b.recipes[1].id = b.recipes[0].id; }).length > 0);
  });

  test("ميزانيّةُ وقتٍ خارج المدى تُرفَض — سقفٌ يمنع تعليقَ المرحلة الخامسة", () => {
    assert.ok(broken((b) => { b.budgetMs = 600000; }).length > 0);
    assert.ok(broken((b) => { b.budgetMs = 10; }).length > 0);
  });

  test("كتابٌ بلا وصفاتٍ أو بوصفاتٍ لا تنتهي يُرفَض", () => {
    assert.ok(broken((b) => { b.recipes = []; }).length > 0);
    assert.ok(broken((b) => { b.recipes = Array.from({ length: 40 }, (_, i) => ({ ...first(b), id: `x${i}` })); }).length > 0);
  });

  test("نافذةُ قراءةٍ خارج المدى تُرفَض", () => {
    assert.ok(broken((b) => { first(b).window = 9; }).length > 0);
  });
});

describe("المسارُ لا يُقدّم الكتابَ لمن لا جلسةَ له", () => {
  const src = code(ROUTE);
  test("يسأل عن جلسة التطبيق ويردّ 401 بلا جلسة", () => {
    assert.match(src, /appViewer\(\)/);
    assert.match(src, /status:\s*401/);
  });
  test("ولا يُقدّم كتاباً فاشلَ التحقّق", () => {
    assert.match(src, /validateBook\(/);
  });
  test("ولا يُخزَّن في كاشٍ وسيط", () => {
    assert.match(src, /no-store/);
  });
});

describe("تعديلُ لهجةٍ لا يُعيد تشغيل حاسبات المكاتب", () => {
  // 🔑 هذا هو سببُ وضع الكتاب تحت `src/app/` لا `src/lib/`: إصلاحُ جهازٍ يجب ألّا
  //    يُسقط جلساتِ واتساب في المكاتب. فلو نُقل الملفُّ يوماً سقط هذا الاختبار.
  for (const f of [BOOK, ROUTE]) {
    test(`${f} ضمن ملفّات الواجهة`, () => {
      assert.ok(UI_ONLY.some((re) => re.test(f)), f);
      assert.ok(!ALWAYS_RESTART.some((re) => re.test(f)), f);
    });
  }
});
