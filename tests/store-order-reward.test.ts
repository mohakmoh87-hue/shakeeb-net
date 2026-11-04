import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🎁🛒 خصمُ رصيد المكافأة في طلبِ متجر الوكيل (قرارُ محمد 2026-11-04) ═════
// الخصمُ يقع **لحظةَ إرسال الطلب** من إجماليّ السلّة، فيصل الطلبُ الوكيلَ بسعرٍ بعد الخصم.
// وهذا مالٌ محروس: ثلاثةُ أخطارٍ يحرسها هذا الملفّ.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ORDERS = "src/app/api/app/store/orders/route.ts";
const FIELD = "src/app/api/field/store-orders/route.ts";
const REWARDS = "src/lib/rewards.ts";

describe("🎁 الخصمُ عند الإرسال — أهليّتُه بالمعرّفات في الخادم", () => {
  test("الخادمُ يحسم الأهليّة: متجرُ وكيله + مكافآتُ مكتبه + رصيدٌ موجود", () => {
    const c = code(ORDERS);
    assert.ok(/viewerAgentId === agentId/.test(c), "لم يُشترَط أن يكون المتجرُ متجرَ وكيله — خصمٌ على حساب وكيلٍ آخر");
    assert.ok(/rewardsEnabled === "1"/.test(c), "لم تُشترَط المكافآتُ مفعّلةً في مكتبه");
    assert.ok(/rewardBalance \?\? 0\) > 0/.test(c), "لم يُشترَط رصيدٌ موجود");
    assert.ok(/b\?\.useReward === true/.test(c), "نيّةُ المشترك لا تُقرأ — خصمٌ لم يطلبه");
  });
  test("العميلُ يرسل نيّةً لا مبلغاً — لا مبلغَ خصمٍ من جسم الطلب", () => {
    const c = code(ORDERS);
    assert.ok(!/b\?\.reward(Used|Amount|Discount)/.test(c), "مبلغُ الخصم يُقرأ من العميل ⇒ خصمٌ مزوَّر");
  });
  test("الخصمُ داخلَ معاملةِ إنشاء الطلب، وسجلُّه يُربط بمعرّفه", () => {
    const c = code(ORDERS);
    assert.ok(/prisma\.\$transaction/.test(c) && /redeemReward\(tx, \{/.test(c), "الخصمُ خارجَ المعاملة ⇒ خصمٌ بلا طلب");
    assert.ok(/context: STORE_ORDER_CTX/.test(c), "الخصمُ بلا سياقِ طلبِ المتجر ⇒ يلتبس بخصم فاتورة");
    assert.ok(/rewardLog\.update\(\{ where: \{ id: redeemLogId \}, data: \{ refId: o\.id \} \}\)/.test(c),
      "سجلُّ الخصم لا يُربط بمعرّف الطلب ⇒ لا يجده الإرجاع");
    assert.ok(/rewardUsed: rewardUsed > 0 \? BigInt\(rewardUsed\) : null/.test(c), "المخصومُ لا يُختَم على الطلب");
  });
});

describe("🔁 الإرجاعُ عند الإلغاء أو الرفض — مرآةُ الخصم", () => {
  test("إلغاءُ المشترك يُرجع الرصيدَ داخلَ المعاملة وبعد الانتقال الذرّيّ وحدَه", () => {
    const c = code(ORDERS);
    assert.ok(/reverseStoreOrderRedeem\(tx, \{/.test(c), "الإلغاءُ لا يُرجع ما خُصِم ⇒ رصيدٌ يتبخّر");
    assert.ok(/if \(claimed\.count !== 1\) return claimed;/.test(c), "الإرجاعُ لا يشترط نجاحَ الانتقال ⇒ إرجاعٌ بلا إلغاء");
  });
  test("رفضُ الوكيل (أو إلغاؤه) يُرجع، و«سُلّم» لا يُرجع", () => {
    const c = code(FIELD);
    assert.ok(/reverseStoreOrderRedeem\(tx, \{/.test(c), "رفضُ الطلب لا يُرجع ما خُصِم");
    assert.ok(/status !== "declined" && status !== "cancelled"/.test(c),
      "شرطُ الحالة غائبٌ ⇒ «سُلّم» قد يُرجع رصيداً استُحقّ خصمُه");
    assert.ok(/if \(claimed\.count !== 1 \|\|/.test(c), "الإرجاعُ لا يشترط نجاحَ الانتقال الذرّيّ");
  });
  test("الإرجاعُ ذرّيٌّ ومحروسٌ من التكرار", () => {
    const c = code(REWARDS);
    assert.ok(/export async function reverseStoreOrderRedeem/.test(c), "لا مسارَ عكسٍ لطلب المتجر");
    assert.ok(/rewardBalance: \{ increment: redeem\.amount \}/.test(c), "الإرجاعُ ليس ذرّيّاً");
    const fn = c.slice(c.indexOf("export async function reverseStoreOrderRedeem"));
    assert.ok(/kind: "redeem-reverse", context: STORE_ORDER_VOID_CTX/.test(fn), "لا حارسَ للعكس المزدوج بسياق الطلب");
  });
});

describe("🔴 حارسُ التلبيس — معرّفُ طلبٍ لا يساوي معرّفَ فاتورة", () => {
  test("عكسُ خصم الفاتورة يستثني سياقَ طلب المتجر في البحثَين", () => {
    const c = code(REWARDS);
    const fn = c.slice(c.indexOf("export async function reverseRewardRedeem"), c.indexOf("export async function reverseStoreOrderRedeem"));
    assert.ok(/kind: "redeem", NOT: \{ context: STORE_ORDER_CTX \}/.test(fn),
      "حذفُ فاتورةٍ رقمُها يساوي رقمَ طلبِ متجرٍ يُرجع خصمَ الطلب — مالٌ يُمنَح مرّتَين");
    assert.ok(/kind: "redeem-reverse", NOT: \{ context: STORE_ORDER_VOID_CTX \}/.test(fn),
      "عكسُ طلبٍ يُسكت عكسَ فاتورةٍ بنفس الرقم ⇒ رصيدُ الفاتورة لا يعود");
  });
  test("سياقا الطلب مصدَّرَان من مكانٍ واحدٍ لا نصّاً مكرَّراً", () => {
    const c = code(REWARDS);
    assert.ok(/export const STORE_ORDER_CTX = "store-order";/.test(c), "سياقُ الطلب غيرُ مصدَّر");
    assert.ok(/export const STORE_ORDER_VOID_CTX = "store-order-void";/.test(c), "سياقُ عكسِ الطلب غيرُ مصدَّر");
    for (const rel of [ORDERS, FIELD]) {
      assert.ok(!/"store-order"/.test(code(rel)), `${rel}: السياقُ نصٌّ حرٌّ ⇒ يفترق عن الحارس`);
    }
  });
});
