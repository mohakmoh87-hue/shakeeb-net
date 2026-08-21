import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pkgSpeedKey, PackageMatcher } from "@/lib/packageMatch";

// ═════ 🎯 دفعةُ 2026-08-21 (بلاغ محمد: «حلٌّ جذريٌّ هذه المرّة») ═════
// قِيست على حسابه الحيّ: ٢٨٢ صفَّ «تحديث معلومات» معلَّقة، فيها ١٢٥ فرقَ باقةٍ
// (٩٩ منها الباقةُ نفسُها باسمَين) و٢٩ فرقَ اسمٍ يمحو ملاحظاتِه و٢٣ فرقَ تاريخٍ
// مجهولَ المصدر (منها ٨ نقصٍ يبلغ شهراً). خمسةُ بنودٍ أقرّها محمد — وهذه حراسُها.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SYNC = () => read("src/lib/subscriptionSync.ts");

describe("🎯 دقّةُ فروق سجلّ المزامنة — البنودُ الخمسة", () => {
  test("أ · «Offer-50Mbps + (60 Days)» هي «Hero 50Mbps +» نفسُها — والسرعةُ وعلامةُ + هما الفيصل", () => {
    assert.equal(pkgSpeedKey("Offer-50Mbps + (60 Days)"), pkgSpeedKey("Hero 50Mbps +"));
    assert.equal(pkgSpeedKey("Offer-50Mbps (60 Days)"), pkgSpeedKey("Hero 50Mbps"));
    // علامةُ + ليست زخرفةً: باقتان مختلفتان لا تُخلطان أبداً
    assert.notEqual(pkgSpeedKey("Hero 50Mbps +"), pkgSpeedKey("Hero 50Mbps"));
    assert.notEqual(pkgSpeedKey("Hero 50Mbps"), pkgSpeedKey("Hero 100Mbps"));
    // والمطابِقُ يترجم اسمَ سوبر سيل إلى باقة البرنامج
    const m = new PackageMatcher([
      { id: 11, name: "Hero 50Mbps +" }, { id: 12, name: "Hero 100Mbps +" }, { id: 13, name: "Hero 50Mbps" },
    ]);
    assert.equal(m.match("Offer-50Mbps + (60 Days)"), 11);
    assert.equal(m.match("Offer-100Mbps + (30 Days)"), 12);
    assert.equal(m.match("Offer-50Mbps (60 Days)"), 13);
  });

  test("أ-ب · حارسُ الالتباس يعلو على مطابقة السرعة — لا تخمينَ حين تتزاحم باقتان", () => {
    const m = new PackageMatcher([
      { id: 21, name: "Hero 50Mbps + شهري" }, { id: 22, name: "Gold 50Mbps + سنوي" },
    ]);
    assert.equal(m.match("Offer-50Mbps + (60 Days)"), null, "سرعةٌ يحملها اسمان ⇒ تُسقَط ولا تُخمَّن");
  });

  test("ب · لا يُرصَد فرقُ باقةٍ لا يستطيع البرنامجُ تطبيقَه (دورةُ الرصد اللانهائيّة)", () => {
    // (ومنذ قاعدةِ محمد 2026-08-21: باقةُ عرضٍ لمن لا باقةَ له عندنا لا تُرصَد أصلاً)
    assert.ok(
      SYNC().includes("if (sv(u.packageName) && !offerOnEmpty && sasPkgIdForDiff != null && sasPkgIdForDiff !== p.packageId) {"),
      "ما زال يُسجَّل فرقُ باقةٍ بلا مقابلٍ في البرنامج — صفٌّ لا يُطبَّق فيتكرّر أبداً",
    );
  });

  test("ج · اسمُنا الحاملُ لملاحظةٍ فوق اسم الساس لا يُرصَد فرقاً — الملاحظةُ تُصان", () => {
    const src = SYNC();
    assert.ok(src.includes("function nameCoversSas("), "لا حارسَ لملاحظات الأسماء");
    assert.ok(src.includes("!nameCoversSas(p.name, u.name)"), "فرقُ الاسم لا يمرّ بالحارس");
  });

  test("د · قفزةُ التاريخ تُسأل عنها الساسُ مباشرةً فتُصنَّف في تبويبها — لا «تمديدٌ» مجهول", () => {
    const sas = read("src/lib/sas4.ts");
    // 🪟 وصار المصدرُ نافذةً مفهرَسةً لا «بحثاً» (بحثُ الساس مُتجاهَلٌ — قياسُ 2026-08-21)
    assert.ok(sas.includes("export async function sasActivationWindow("), "لا نافذةَ تفعيلاتٍ مفهرَسة");
    assert.ok(sas.includes("complete: boolean;"), "النافذةُ لا تفرّق العطلَ عن «لا نتيجة»");
    const src = SYNC();
    assert.ok(src.includes("const classifyDateJump = async ("), "لا تصنيفَ لقفزة التاريخ");
    assert.ok(src.includes("classified = await classifyDateJump(p, u.sasId, u.username, validDate);"), "المُصنِّفُ لا يُنادى من كتلة الفروق");
    // 💰 قاعدةُ محمد: وصلٌ عندي ⇒ ليس خارجيّاً
    assert.ok(src.includes("if (await collectedByUs(uKey, sub.id, actAt, newSasExp)) return false;"), "المُصنِّفُ يتجاوز قاعدةَ الوصل");
    // والتصنيفُ ثلاثيٌّ بالمنجر كما في حلقة الأحداث
    assert.ok(src.includes(`await recordActivationEvent(managerIsPage ? "sas" : "self", { ...evBase, loan: isLoanAct });`), "التصنيفُ بالمنجر غاب عن المُصنِّف");
    assert.ok(src.includes("await recordCompanyActivation({ ...evBase, loan: isLoanAct, managerName: mgr || null });"), "تفعيلُ الشركة غاب عن المُصنِّف");
    // ولا يُسأل إلّا عن الزيادة، وبسقف
    assert.ok(src.includes("if (!classified && grew && dateProbes < MAX_DATE_PROBES) {"), "المسبارُ بلا سقفٍ أو يُستدعى للنقص أيضاً");
  });

  test("هـ · نقصُ أيّامٍ يتجاوز أسبوعاً يُوسَم خطراً ويخرج من «تحديد الكلّ»", () => {
    const src = SYNC();
    assert.ok(src.includes("...(lostDays > 7 ? { danger: true } : {}),"), "النقصُ الكبيرُ بلا وسمِ خطر");
    assert.ok(read("src/lib/syncLog.ts").includes("danger?: boolean }"), "نوعُ التغيير لا يحمل وسمَ الخطر");
    const ui = read("src/components/SyncLogModal.tsx");
    assert.ok(ui.includes("const isDangerRow = (r: Row) => (r.changes ?? []).some((c) => c.danger);"), "الواجهةُ لا تعرف الصفَّ الخَطِر");
    assert.ok(ui.includes("const bulkable = view.filter((r) => !isDangerRow(r));"), "الصفُّ الخَطِر ما زال يدخل «تحديد الكلّ»");
    assert.ok(ui.includes("setSel(allSel ? new Set() : new Set(bulkable.map((r) => r.id)))"), "زرُّ الكلّ ما زال يحدّد الخَطِر");
  });
});
