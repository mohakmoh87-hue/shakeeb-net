import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ البند ٦ · وصلُ تسديد الدين المطبوع (طلبُ محمد) ═════
//
// رسالةُ الواتساب عند التسديد كانت موجودةً سلفاً (قالبُ `debtPaid`)؛ الناقصُ **الورقةُ
// المطبوعة**. وقالبٌ ثالثٌ مستقلٌّ لا حقولٌ تُزاد على وصل الاشتراك: التسديدُ لا باقةَ
// فيه ولا أشهرَ ولا تاريخَ انتهاء — وخلطُهما يُنتج وصلاً بحقولٍ فارغةٍ يُحيّر المشترك.
//
// 🔑 وأخطرُ قرارٍ فيه: **مرجعُ الوصل قيدُ الصندوق (`moneyTx`) لا المشترك.** فمَن سدّد
//   مرّتَين في يومٍ له وصلان مختلفان؛ ولو رُبِط الوصلُ بالمشترك لَطُبع الأخيرُ مرّتَين
//   ولَما أمكن إعادةُ طبع الأوّل أبداً.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("البند ٦ · وصلُ تسديد الدين", () => {
  test("قالبٌ ثالثٌ مستقلٌّ بمفتاحه وحقوله — لا حقولٌ تُزاد على وصل الاشتراك", async () => {
    const paper = await import("../src/lib/receiptPaper");
    const keys = paper.DEBT_FIELDS.map((f) => f.key);
    // حقولٌ لا معنى لها في تسديد دين — وجودُها يعني أنّ القالبَ نُسخ لا صُمِّم
    for (const bad of ["package", "months", "dateFrom", "dateTo"]) {
      assert.equal(keys.includes(bad as never), false, `حقلٌ لا يخصّ تسديدَ الدين: ${bad}`);
    }
    // وحقولُه الجوهريّة حاضرة
    for (const need of ["paid", "debtBefore", "debtAfter", "subscriber", "receiptNo"]) {
      assert.ok(keys.includes(need as never), `حقلٌ جوهريٌّ غائب: ${need}`);
    }
    // والترتيبُ يُصحَّح ولا يُصدّق كما يأتي (مفتاحٌ مجهولٌ يُطرَح، والناقصُ يُضاف)
    assert.deepEqual(paper.resolveDebtOrder(["paid", "لا-يوجد", "paid"])[0], "paid");
    assert.equal(paper.resolveDebtOrder([]).length, paper.DEBT_FIELDS.length, "الترتيبُ الفارغ لا يُكمَل بالافتراضي");
    // وكلُّ الحقول ظاهرةٌ افتراضاً إلّا «اسمُ المكتب في التذييل» (كالنوعَين الآخرَين)
    const def = paper.resolveDebtFields(null);
    assert.equal(def.paid, true);
    assert.equal(def.officeInFooter, false, "اسمُ المكتب في التذييل يجب أن يبقى مُطفأً كالنوعَين الآخرَين");
  });

  test("مرجعُ الوصل قيدُ الصندوق لا المشترك — فيُعاد طبعُه بعينه", () => {
    // المسارُ يُعيد رقمَ القيد، والواجهةُ تطبع به
    const pay = read("src/app/api/debts/[id]/pay/route.ts");
    assert.match(pay, /const \[, tx\] = await prisma\.\$transaction/, "القيدُ لا يُقتنَص من المعاملة");
    assert.match(pay, /txId: tx\.id/, "رقمُ القيد لا يُعاد للواجهة ⇒ لا سبيلَ لطبع وصلٍ بعينه");
    const page = read("src/app/(app)/debts/page.tsx");
    assert.match(page, /kind: "debt", id: data\.txId/, "الواجهةُ تطبع بمرجعٍ غيرِ القيد");
    // والمُصيِّرُ يقرأ القيدَ لا آخرَ تسديدٍ للمشترك
    const html = read("src/lib/printReceiptHtml.ts");
    assert.match(html, /export async function debtSlipHtml\(txId: number/, "المُصيِّرُ لا يأخذ رقمَ القيد");
    assert.match(html, /prisma\.moneyTx\.findUnique\(\{ where: \{ id: txId \} \}\)/, "المُصيِّرُ لا يقرأ القيد");
  });

  test("🔒 النوعُ شرطٌ: قيدٌ ليس تسديدَ دينٍ لا يُطبَع بقالب الدين", () => {
    // بلا هذا الشرط يُطبَع وصلُ «تسديد دين» لمصروفٍ أو تفعيلٍ بمجرّد تمرير رقمه
    for (const f of ["src/app/api/print/route.ts", "src/lib/printReceiptHtml.ts"]) {
      const src = read(f);
      assert.match(src, /sourceType !== "debt" && [\s\S]{0,40}sourceType !== "master-debt"/,
        `${f}: لا يفحص نوعَ القيد قبل الطبع`);
    }
  });

  test("🔒 العزل: مكتبُ القيد ووكيلُ المشترك مفحوصان قبل الطبع", () => {
    const api = read("src/app/api/print/route.ts");
    // مسارُ الطباعة يفحص ملكيّةَ المكتب لكلّ الأنواع بعد استخراج towerId
    assert.match(api, /ownsTower\(session, towerId\)/, "أمرُ الطباعة بلا فحصِ ملكيّة المكتب");
    const html = read("src/lib/printReceiptHtml.ts");
    const fn = html.slice(html.indexOf("export async function debtSlipHtml"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    // تحصينٌ ثانٍ على العامل: مكتبُ القيد يطابق مكتبَ أمر الطباعة
    assert.match(body, /jobTowerId != null && tx\.towerId !== jobTowerId/, "لا تحصينَ لمكتب أمر الطباعة");
    // وعزلُ الوكيل: مشتركُ القيد يتبع مكتباً من مكاتب هذا الوكيل
    assert.match(body, /prisma\.tower\.findFirst\(\{ where: \{ id: s\.towerId, agentId \}/, "لا فحصَ لوكيل المشترك");
  });

  test("الطبعُ اختياريٌّ بزرٍّ ثانٍ — ولا يُفشل التسديدَ تعذُّرُه", () => {
    const page = read("src/app/(app)/debts/page.tsx");
    // نمطُ نافذة التفعيل نفسُه: «تسديد» و«تسديد وطباعة» — لا سلوكَ جديدٌ يُتعلَّم
    assert.match(page, /تسديد وطباعة/, "لا زرَّ «تسديد وطباعة»");
    assert.match(page, /async function pay\(e: React\.FormEvent, print = false\)/, "الطبعُ ليس اختياريّاً");
    // 🔑 والتسديدُ مالٌ: لا يجوز أن يُسقطه فشلُ طابعة
    assert.match(page, /body: JSON\.stringify\(\{ kind: "debt", id: data\.txId \}\),\s*\r?\n\s*\}\)\.catch\(\(\) => \{\}\)/,
      "فشلُ أمر الطباعة غيرُ مُلتقَط — قد يُسقط التسديد");
  });

  test("القالبُ الجديد مربوطٌ في السلسلة كلِّها — لا حلقةَ ناقصة", () => {
    // القالب ← الحاصد ← الموزّع ← الواجهة: نقصُ حلقةٍ يجعل الزرَّ لا يطبع شيئاً بصمت
    assert.match(read("src/lib/receiptTemplate.ts"), /export async function getDebtTemplate/, "لا قارئَ للقالب");
    assert.match(read("src/lib/printAgent.ts"), /kind === "debt"/, "الموزّعُ لا يعرف النوع");
    assert.match(read("src/app/api/receipt-template/route.ts"), /v === "debt" \? "debt"/, "مسارُ القالب لا يعرف النوع");
    assert.match(read("src/app/(app)/receipt-template/page.tsx"), /setKind\("debt"\)/, "لا تبويبَ في صفحة القالب");
    assert.match(read("src/components/PrintNowButton.tsx"), /"invoice" \| "debt"/, "زرُّ الطباعة لا يقبل النوع");
  });
});
