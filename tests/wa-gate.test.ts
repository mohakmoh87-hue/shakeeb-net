import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withWaTurn, clampGapSeconds, isWaBusy, WA_BUSY, WA_GAP_DEFAULT, WA_GAP_MIN, WA_GAP_MAX, waQueueDepth } from "../src/lib/waGate";

// ═════ 🚦 بوّابةُ رقم الواتساب — طلبُ محمد 2026-08-25 ═════
//
// نصُّه: «أريد حارسَ الـ١٠ ثوانٍ في كلّ الرسائل إذا كانت أكثرَ من رسالةٍ في نفس الوقت،
// سواءٌ في طابورٍ أو بشكلٍ مباشر… وأريد أن أستطيع تغييرَ الـ١٠ ثوانٍ إلى أقلَّ أو أكثر».
//
// 🔴 والعلّةُ المقيسة: الفاصلُ كان مكتوباً في **ستّة مواضعَ منفصلة** لا يعرف أحدُها الآخر،
//   و**أحدَ عشرَ مساراً مباشراً بلا أيّ فاصل** ⇒ فالرقمُ قد يرى رسالةً كلَّ ثانيتَين.
//   الدليلُ الحيّ: دفعةُ الشدن **١٢ رسالةً في الدقيقة نفسِها (2026-08-25 00:33)**.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ok = async () => ({ ok: true as const });

describe("🚦 بوّابةُ الفاصل — السلوك", () => {
  test("رسالتان متزامنتان على المكتب نفسِه ⇒ الثانيةُ تنتظر الفاصلَ كاملاً", async () => {
    const GAP = 120;
    const at: number[] = [];
    const t0 = Date.now();
    await Promise.all([
      withWaTurn(9001, "bulk", 5_000, async () => { at.push(Date.now() - t0); return ok(); }, GAP),
      withWaTurn(9001, "bulk", 5_000, async () => { at.push(Date.now() - t0); return ok(); }, GAP),
      withWaTurn(9001, "bulk", 5_000, async () => { at.push(Date.now() - t0); return ok(); }, GAP),
    ]);
    assert.equal(at.length, 3);
    // 🔑 الفاصلُ يُقاس من **انتهاء** السابقة (نفسُ سلوك `await sleep(GAP)` القديم في ذيل الحلقات)
    assert.ok(at[1] - at[0] >= GAP - 25, `الفاصل الأوّل ${at[1] - at[0]}ms < ${GAP}`);
    assert.ok(at[2] - at[1] >= GAP - 25, `الفاصل الثاني ${at[2] - at[1]}ms < ${GAP}`);
  });

  test("🔒 مكتبان مختلفان لا يحجب أحدُهما الآخر — لكلٍّ رقمُه", async () => {
    // بوّابةٌ عامّةٌ لكلّ الوكلاء كانت ستجعل بثَّ مكتبٍ واحدٍ يُجمّد رسائلَ الجميع ساعاتٍ.
    const GAP = 400;
    const t0 = Date.now();
    let bAt = -1;
    await Promise.all([
      withWaTurn(9101, "bulk", 5_000, async () => { await new Promise((r) => setTimeout(r, 60)); return ok(); }, GAP),
      withWaTurn(9102, "bulk", 5_000, async () => { bAt = Date.now() - t0; return ok(); }, GAP),
    ]);
    assert.ok(bAt >= 0 && bAt < GAP, `مكتبٌ آخرُ انتظر ${bAt}ms — البوّابةُ ليست لكلّ مكتب`);
  });

  test("🚀 المسارُ العاجلُ يسبق الدفعات — والفاصلُ لا يتغيّر", async () => {
    // قرارُ محمد: «مسارٌ عاجلٌ لليدويّ». مشتركٌ واقفٌ أمام الموظّف لا ينتظر خلف بثٍّ من ألفَين.
    const GAP = 60;
    const order: string[] = [];
    const first = withWaTurn(9201, "bulk", 5_000, async () => { await new Promise((r) => setTimeout(r, 80)); order.push("قيد التنفيذ"); return ok(); }, GAP);
    await new Promise((r) => setTimeout(r, 10)); // ليصير الاثنان في الانتظار خلف الجارية
    const b1 = withWaTurn(9201, "bulk", 5_000, async () => { order.push("دفعة"); return ok(); }, GAP);
    const u1 = withWaTurn(9201, "urgent", 5_000, async () => { order.push("عاجل"); return ok(); }, GAP);
    await Promise.all([first, b1, u1]);
    assert.deepEqual(order, ["قيد التنفيذ", "عاجل", "دفعة"], "الدفعةُ سبقت اليدويَّ رغم أنّه دخل بعدها");
  });

  test("⏳ تجاوزُ سقف الانتظار يعيد WA_BUSY — **ولا تُرسَل الرسالة**", async () => {
    // 🔑 هذا هو الفرقُ الذي يمنع التكرارَ: البوّابةُ تتنازل **قبل** الإرسال لا بعده،
    //    فالطابورُ يُعيد الصفَّ بلا خطرِ نسختَين.
    const GAP = 500;
    let ran = 0;
    const busy = withWaTurn(9301, "bulk", 5_000, async () => { await new Promise((r) => setTimeout(r, 300)); return ok(); }, GAP);
    await new Promise((r) => setTimeout(r, 10));
    const r = await withWaTurn(9301, "bulk", 30, async () => { ran++; return ok(); }, GAP);
    await busy;
    assert.equal(r.ok, false);
    assert.ok(isWaBusy((r as { error?: string }).error), `الرسالةُ ليست علامةَ ازدحام: ${(r as { error?: string }).error}`);
    assert.equal(ran, 0, "🔴 نُفِّذ الإرسالُ رغم التنازل ⇒ خطرُ نسخةٍ ثانية");
  });

  test("🛡️ فشلُ الإرسال لا يُجمّد الرقمَ — الدورُ يُسلَّم دائماً", async () => {
    const GAP = 30;
    await assert.rejects(() => withWaTurn(9401, "urgent", 1_000, async () => { throw new Error("انفجار"); }, GAP));
    assert.equal(waQueueDepth(9401), 0);
    const after = await withWaTurn(9401, "urgent", 1_000, ok, GAP);
    assert.equal(after.ok, true, "🔴 بقي الرقمُ محجوزاً بعد انهيارِ نداءٍ — جمودٌ أبديّ");
  });
});

describe("⏱️ الفاصلُ صار إعداداً — بحارسٍ خادميّ", () => {
  test("القصُّ إلى المدى، والفاسدُ يعود للافتراضيّ لا للصفر", () => {
    assert.equal(clampGapSeconds("25"), 25);
    assert.equal(clampGapSeconds(WA_GAP_MIN - 1), WA_GAP_MIN);
    assert.equal(clampGapSeconds(WA_GAP_MAX + 40), WA_GAP_MAX);
    // 🔴 صفرٌ = رشقةٌ بلا فاصل = حظرُ الرقم. لا يُقبَل من أيّ مدخَل.
    assert.equal(clampGapSeconds("0"), WA_GAP_DEFAULT);
    assert.equal(clampGapSeconds("-5"), WA_GAP_DEFAULT);
    assert.equal(clampGapSeconds("سبعة"), WA_GAP_DEFAULT);
    assert.equal(clampGapSeconds(null), WA_GAP_DEFAULT);
    assert.equal(clampGapSeconds(undefined), WA_GAP_DEFAULT);
    assert.equal(WA_GAP_DEFAULT, 10, "الافتراضيُّ تغيّر — ومن لم يلمس الإعدادَ يجب ألّا يتغيّر عنده شيء");
  });

  test("🔒 والحارسُ في الخادم لا في الواجهة وحدَها", () => {
    const api = read("src/app/api/settings/route.ts");
    assert.match(api, /clampGapSeconds\(value\)/, "المسارُ يكتب قيمةَ المستخدم بلا قصّ ⇒ صفرٌ يُحظَر به الرقم");
    assert.match(api, /"waGapSeconds"/, "المفتاحُ غيرُ معروفٍ في مسار الإعدادات");
    assert.match(api, /forgetGapCache\(\)/, "لا إبطالَ للمخزَّن ⇒ ينتظر الوكيلُ دقيقةً ليرى أثرَ ضبطه");
  });
});

describe("🔗 البوّابةُ مربوطةٌ بالمكان الوحيد الذي لا يُتجاوَز", () => {
  test("كلُّ إرسالٍ يمرّ بالبوّابة — محلّيّاً وعبر المُرحِّل", () => {
    const wa = read("src/lib/whatsapp.ts");
    // الإرسالُ الفعليُّ صار خلف البوّابة، والمُرحِّلُ يمرّ بها أيضاً بسقفٍ أقصر
    assert.match(wa, /return withWaTurn\(officeId, lane, maxWaitMs, \(\) => sendWhatsAppNow\(/, "نقطةُ الإرسال لم تعد خلف البوّابة");
    assert.match(wa, /sendWhatsAppLocal\(relayRow\.towerId,[^)]*p\.lane \?\? "urgent", WA_WAIT_RELAY\)/, "الممرَّرُ لا يمرّ بالبوّابة أو فقد مسارَه");
    // 🔑 سقفُ الممرَّر أقصرُ من مهلة المُرحِّل (٤٥ث) — وإلّا خُتمت رسالةٌ «غير مؤكَّدة» ولم تخرج
    assert.match(wa, /const WA_WAIT_RELAY = 15_000;/, "سقفُ انتظار الممرَّر تغيّر — قِسه على مهلة المُرحِّل ٤٥ث");
    assert.match(wa, /relayRequest\(officeId, "sendMsg", \{ phone, text, image: image \?\? null, lane \}/, "المسارُ لا يعبر المُرحِّل ⇒ تفقد الرسائلُ الممرَّرةُ أولويّتَها");
  });

  test("🧹 لا فاصلَ محلّيّاً باقياً — وإلّا صار الفاصلُ ضِعفَين", () => {
    // الستّةُ القديمة: ثلاثةٌ في المجدول وثلاثةٌ في الطوابير
    const sch = read("src/lib/scheduler.ts");
    assert.equal(/await sleep\(10000\)/.test(sch), false, "عاد فاصلٌ محلّيٌّ في المجدول ⇒ ضِعفُ الفاصل");
    assert.equal(/GAP_MS/.test(read("src/lib/broadcastQueue.ts")), false, "عاد فاصلُ ساحب البثّ المحلّيّ");
    assert.equal(/GAP_MS/.test(read("src/lib/syncAutoMsg.ts")), false, "عاد فاصلُ طابور سجلّ المزامنة المحلّيّ");
    assert.equal(/SELF_ACT_GAP_MS/.test(read("src/lib/selfActivatedNotice.ts")), false, "عاد فاصلُ طابور «فعّل بنفسه» المحلّيّ");
  });

  test("🚚 الدفعاتُ الستُّ تُصرّح بمسارها — والباقي عاجلٌ افتراضاً", () => {
    // الافتراضيُّ `urgent` عمداً: النسيانُ يقع في الجانب الآمن (رسالةُ إنسانٍ لا تنتظر)
    assert.match(read("src/lib/messaging.ts"), /lane: "urgent" \| "bulk" = "urgent"/, "الافتراضيُّ لم يعد العاجل");
    const sch = read("src/lib/scheduler.ts");
    assert.equal((sch.match(/, "bulk"\)/g) ?? []).length, 3, "دفعاتُ المجدول الثلاث (انتهاء · ديون · منتهون) لم تعد كلُّها bulk");
    assert.match(read("src/lib/broadcastQueue.ts"), /sendWhatsApp\(towerId, job\.phone, job\.text, image, "bulk"\)/, "ساحبُ البثّ ليس دفعة");
    assert.match(read("src/lib/syncAutoMsg.ts"), /image, "bulk"\)/, "طابورُ سجلّ المزامنة ليس دفعة");
    assert.match(read("src/lib/selfActivatedNotice.ts"), /queueImage, "bulk"\)/, "طابورُ «فعّل بنفسه» ليس دفعة");
  });

  test("🛟 «لم يحن دورُه» يعيد الصفَّ للطابور ولا يُختَم فاشلاً", () => {
    // 🔴 بلا هذا، الازدحامُ اللحظيُّ يُعدِم الرسالةَ نهائيّاً: الطابورُ يختم `FAILED`
    //    ولا يُعيد الإرسالَ أبداً (بحكم «الحَجز قبل الأثر»).
    const bq = read("src/lib/broadcastQueue.ts");
    assert.match(bq, /isWaBusy\(outcome\.error\)/, "ساحبُ البثّ يختم الازدحامَ فشلاً");
    const sa = read("src/lib/selfActivatedNotice.ts");
    assert.match(sa, /else if \(isWaBusy\(res\.error\)\) \{[\s\S]*?status: "PENDING", error: null/, "طابورُ «فعّل بنفسه» يختم الازدحامَ فشلاً فتضيع الرسالة");
    // وطابورُ سجلّ المزامنة يُعيد أيَّ تعذُّرٍ إلى الطابور أصلاً — فلا يحتاج استثناءً
    assert.match(read("src/lib/syncAutoMsg.ts"), /data: \{ status: "PENDING", error: SYNC_MSG_MARK \}/, "طابورُ سجلّ المزامنة لم يعد يُعيد المتعذّر للطابور");
    // ومحاولةٌ ثانيةٌ واحدةٌ لمن لا طابورَ له (تذكيرُ الانتهاء ورسائلُ الديون)
    assert.match(read("src/lib/whatsapp.ts"), /if \(!r0\.ok && isWaBusy\(r0\.error\)\) \{/, "لا محاولةَ ثانيةَ لمن لا طابورَ له");
  });

  test("🔒 والمُرحِّلُ لا يتجمّد خلف الإرسال — الساسُ والمحادثاتُ أوّلاً", () => {
    const wa = read("src/lib/whatsapp.ts");
    assert.match(wa, /found\.filter\(\(r\) => r\.kind !== "sendMsg"\)/, "صفوفُ الإرسال لم تعد مؤخَّرةً عن بقيّة العمليّات");
    assert.match(wa, /found\.filter\(\(r\) => r\.kind === "sendMsg"\)\.slice\(0, 1\)/, "أكثرُ من صفّ إرسالٍ في الدورة ⇒ تجميدُ الساس دقائق");
  });

  test("🧪 والبوّابةُ منطقُ توقيتٍ محضٌ — تُستورَد بلا قاعدةِ بيانات", () => {
    const g = read("src/lib/waGate.ts");
    assert.equal(/^import .*from "\.\/prisma"/m.test(g), false, "استيرادُ القاعدة عاد إلى رأس الملفّ ⇒ تسقط الاختبارات وتثقل البوّابة");
    assert.match(g, /await import\("\.\/prisma"\)/, "قراءةُ الإعداد لم تعد باستيرادٍ متأخّر");
  });
});
