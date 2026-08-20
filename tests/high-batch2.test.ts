import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ الستّةُ العالية المؤجَّلة — نُفّذت بقرارات 2026-08-19 ═════
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("أ · مسارُ التفعيل الموروث POST /api/subscriptions أُزيل", () => {
  test("لا POST — وGET باقٍ حرفيّاً", () => {
    const c = code("src/app/api/subscriptions/route.ts");
    assert.ok(!/export async function POST/.test(c), "عاد POST الموروث — قبضٌ بلا sourceId يضيع عند الحذف العكسيّ");
    assert.ok(/export async function GET/.test(c), "GET سقط — سجلُّ الوصولات يستهلكه");
  });
});

describe("ب · عكسُ خصم المكافأة مع حذف الفاتورة", () => {
  test("reverseRewardRedeem موجودةٌ وتحرس العكسَ المزدوج وتُرجع ذرّيّاً", () => {
    const c = code("src/lib/rewards.ts");
    assert.ok(/export async function reverseRewardRedeem/.test(c), "لا عكسَ للسحب — المشترك يفقد رصيدَه عند حذف الفاتورة");
    assert.ok(/kind: "redeem-reverse"/.test(c), "لا سجلَّ للعكس");
    assert.ok(/rewardBalance: \{ increment: redeem\.amount \}/.test(c), "الإرجاعُ ليس ذرّيّاً");
    assert.ok(/if \(already\) return 0/.test(c), "لا حارسَ للعكس المزدوج");
  });
  test("سجلُّ الخصم يُربط بالفاتورة في المُنشئَين (البيع والصيانة)", () => {
    assert.ok(/redeemLogId/.test(code("src/app/api/invoices/route.ts")), "فاتورةُ البيع لا تربط سجلَّ خصمها");
    assert.ok(/redeemLogId/.test(code("src/app/api/field/complete/route.ts")), "فاتورةُ الصيانة لا تربط سجلَّ خصمها");
  });
  test("العكسُ مستدعىً من مسارَي الحذف كليهما (درسُ reverseInvoiceStock)", () => {
    assert.ok(/reverseRewardRedeem\(/.test(code("src/app/api/invoices/[id]/void/route.ts")), "حذفُ الفاتورة لا يعكس الخصم");
    assert.ok(/reverseRewardRedeem\(/.test(code("src/app/api/money/[id]/void/route.ts")), "حذفُها من الصندوق لا يعكس الخصم — تفرّق المساران");
  });
});

describe("ج · هدنةُ المكتب المطفأ في طابور البثّ", () => {
  const Q = "src/lib/broadcastQueue.ts";
  test("الحجزُ يستثني مكاتبَ الهدنة ورسائلُ بلا مشتركٍ تُحجَز دائماً", () => {
    const c = code(Q);
    // ⚠️ الصيغةُ NOT EXISTS لا LEFT JOIN (إصلاح 2026-08-20): القديمةُ كانت
    // `LEFT JOIN … FOR UPDATE` وPostgres يرفضها فيموت الساحبُ لحظةَ أوّلِ هدنة —
    // تجمّد بثُّ 169 رسالةً خلفها. NOT EXISTS تعطي الدلالةَ نفسَها بلا وجهٍ خارجيّ:
    // رسالةٌ بلا مشتركٍ لا تُطابق الوجودَ فتُحجَز دائماً، ومكتبُ الهدنة يُستثنى.
    assert.ok(/NOT EXISTS \(\s*SELECT 1 FROM subscribers s\s*WHERE s\.id = m\."subscriberId" AND s\."towerId" = ANY\(/.test(c), "استثناءُ الهدنة زال من الحجز");
    assert.ok(!/LEFT JOIN[\s\S]{0,300}FOR UPDATE(?! OF)/.test(c), "عاد FOR UPDATE فوق وجهٍ خارجيٍّ — الصيغةُ التي تقتل الساحب");
  });
  test("الغيابُ هدنةٌ للمكتب وحدَه — والصفُّ يبقى منتظراً (لا FAILED)", () => {
    const c = code(Q);
    assert.ok(/cooldowns\(\)\.set\(jobTowerId, Date\.now\(\) \+ OFFLINE_RETRY_MS\)/.test(c), "الغيابُ ما زال نوماً يحجب الجميع");
    assert.ok(!/offline[\s\S]{0,200}status: 'FAILED'/.test(c), "الغيابُ يختم فشلاً — خالف «يبقى منتظراً»");
  });
  test("مؤقّتُ إيقاظٍ ذاتيّ حين تكون كلُّ الصفوف خلف هدنٍ — لا انتظارَ ركلةٍ خارجيّة", () => {
    const c = code(Q);
    assert.ok(/kickBroadcastDrainer\("انقضت هدنةُ مكتب"\)/.test(c), "لا إيقاظَ ذاتيّاً — الصفوفُ تنتظر ركلةً قد لا تجيء");
  });
});

describe("د · مسبارُ جهوزيّة الواتساب الحقيقيّ", () => {
  const W = "src/lib/whatsapp.ts";
  test("الختمُ يُجدَّد بسؤال العميل (getState) لا بفحص المتغيّر المخزون", () => {
    const c = code(W);
    assert.ok(/async function ensureReadyIsReal/.test(c), "لا مسبارَ — الكذبةُ تُوثَّق كلَّ ٨ ثوانٍ");
    assert.ok(/client\.getState\(\)/.test(c), "المسبارُ لا يسأل العميلَ نفسَه");
    assert.ok(/await ensureReadyIsReal\(boundTower\)/.test(c), "الفرعُ المربوط لا يستعمل المسبار");
    assert.ok(/await ensureReadyIsReal\(id\)/.test(c), "الفرعُ غيرُ المربوط لا يستعمل المسبار");
  });
  test("🛡️ لا هدمَ على فشلٍ عابر: فشلان متتاليان + مهلةٌ للمسبار", () => {
    const c = code(W);
    assert.ok(/probeFails >= 2/.test(c), "هدمٌ من أوّل فشل — مسبارٌ بطيءٌ يهدم جلسةً سليمة");
    assert.ok(/PROBE_TIMEOUT_MS/.test(c), "مسبارٌ بلا مهلة — يُعلّق النبضةَ كلَّها");
  });
});

describe("هـ · حذفُ التفعيل من الصندوق يمحو توائمَه (المختلط)", () => {
  test("فرعُ activation يحذف كلَّ حركات الوصل (activation/manual/master)", () => {
    const c = code("src/app/api/money/[id]/void/route.ts");
    assert.ok(/sourceId: entry\.id, sourceType: \{ in: \["activation", "manual", "master"\] \}/.test(c),
      "شقُّ الماستر يبقى حيّاً بلا وصلٍ ولا سبيلَ لحذفه");
  });
});

describe("و · العودةُ من الماستر تستدلّ النوعَ ولا تكتب null", () => {
  test("convertKind يستدلّ بيع/بيع مباشر من وجود المشترك", () => {
    const c = code("src/app/api/_lib/convertKind.ts");
    assert.ok(!/data: \{ type: toMaster \? "ماستر" : null \}/.test(c), "العودةُ تكتب null — الفاتورةُ تختفي من التقارير");
    assert.ok(/inv\.subscriberId != null \? "بيع" : "بيع مباشر"/.test(c), "لا استدلالَ للنوع الأصليّ");
  });
});
