import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ الثمانيةُ العالية النظيفة من المسح العدائيّ (2026-08-19) ═════
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("الأزرارُ الخرساء — الخطأُ يُعرَض والحالةُ تتراجع", () => {
  const F = "src/app/(app)/field-management/page.tsx";
  test("addCard: التصفيرُ بعد النجاح، وelse يعرض الخطأ", () => {
    const c = code(F);
    // التصفيرُ داخل if(r.ok) لا قبل fetch
    assert.ok(/if \(r\.ok\) \{[\s\S]*?setCardText\(""\)/.test(c), "addCard يُصفّر قبل النجاح — يضيع النصُّ عند الفشل");
    assert.ok((c.match(/تعذّرت إضافةُ البطاقة/) ?? []).length > 0, "addCard بلا رسالةِ فشل");
  });
  test("addList/renameList/deleteList/deleteCard تفحص r.ok وتتراجع بإعادة التحميل", () => {
    const c = code(F);
    assert.ok(/تعذّرت إضافةُ العمود/.test(c), "addList أخرس");
    assert.ok(/تعذّرت إعادةُ التسمية/.test(c) && /load\(officeId\); alert/.test(c), "renameList بلا تراجع");
    assert.ok(/تعذّر حذفُ العمود/.test(c), "deleteList أخرس");
    assert.ok(/تعذّر حذفُ البطاقة/.test(c), "deleteCard أخرس");
  });
  test("حذفُ المستخدم يعرض سببَ الرفض", () => {
    const c = code("src/app/(app)/users/page.tsx");
    assert.ok(/else \{ const d = await res\.json\(\)\.catch[\s\S]*?setError/.test(c), "remove يبتلع خطأ الخادم");
  });
});

describe("طباعةُ التفعيل لم تعد صامتة", () => {
  test("تُنتظَر وتُفحَص ok/workerOnline قبل onDone", () => {
    const c = code("src/components/ActivationModal.tsx");
    assert.ok(/const pr = await fetch\("\/api\/print"/.test(c), "الطباعةُ ما زالت fire-and-forget");
    assert.ok(/pd\.workerOnline === false/.test(c), "لا فحصَ لاتّصال حاسبة المكتب");
    // onDone بعد فحص الطباعة (لا يُمنَع الإغلاق)
    assert.ok(c.indexOf("workerOnline === false") < c.indexOf("onDone()"), "الفحصُ بعد onDone");
  });
});

describe("سباقاتٌ صارت ذرّيّة", () => {
  test("بيعُ الكارت يشترط useDate:null ويردّ 409 للمستهلَك", () => {
    const c = code("src/app/api/recharge-cards/[id]/sell/route.ts");
    assert.ok(/agentId: session\?\.agentId \?\? -1, useDate: null/.test(c), "البيعُ لا يشترط غيرَ المستهلَك");
    assert.ok(/status: 409/.test(c), "لا رفضَ 409 للكارت المستهلَك");
  });
  test("خصمُ المكافأة ذرّيٌّ بشرطِ gte وفحصِ عدّ", () => {
    const c = code("src/lib/rewards.ts");
    assert.ok(/rewardBalance: \{ gte: discount \}/.test(c), "الخصمُ لا يشترط رصيداً كافياً ذرّيّاً");
    assert.ok(/rewardBalance: \{ decrement: discount \}/.test(c), "الخصمُ مطلقٌ لا ذرّيّ");
    assert.ok(/claimed\.count !== 1/.test(c), "لا فحصَ لنجاح الخصم الذرّيّ");
  });
  test("إرجاعُ التسديد يقفل صفَّ التسديدة (FOR UPDATE)", () => {
    const c = code("src/app/api/money/settlements/route.ts");
    assert.ok(/FROM money_tx WHERE id = \$\{stx\} FOR UPDATE/.test(c), "إرجاعُ التسديد بلا قفلِ صفّ — إرجاعان متزامنان يضيّعان إنقاصاً");
  });
});
