import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ ➕ نافذةُ إضافة مادة — اقتراحُ محمد 2026-08-25 ═════
//
// «لِمَ لا يكون عند إضافة مادة تظهر لائحةٌ بكلّ المواد كما يمكن البحثُ عن مادة، وإذا
//  اخترتَ مادةً تكتب سعرَها وكميّتَها وتضيفها؛ أو يمكن كتابةُ اسم مادةٍ غير موجودةٍ
//  لإضافتها كمادّةٍ جديدة وتبقى نفسُ خيارات الإضافة من سعرٍ وغيره».
// وقرارُه بعدها: **الزرُّ للمدير وحدَه · المكتبُ يُختار في النافذة · و«تعديل» يعود
//  بسيطاً: يزيد أو ينقص عددَ مادةٍ فقط**.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const MODAL = () => read("src/components/AddItemModal.tsx");
const PAGE = () => read("src/app/(app)/inventory/page.tsx");
const POST = () => read("src/app/api/items/route.ts");
const PUT = () => read("src/app/api/items/[id]/route.ts");

describe("🔒 حارسُ تكرار الاسم — في الخادم لا في الشاشة", () => {
  test("اسمٌ موجودٌ في المكتب نفسِه يُرَدّ 409 ولا يُنشَأ صفٌّ ثانٍ", () => {
    const src = POST();
    assert.match(src, /where: \{ towerId, isDeleted: false, name: \{ equals: wantName, mode: "insensitive" \} \}/,
      "🔴 لا فحصَ للتكرار ⇒ صفّان بالاسم نفسِه ينقسم بينهما المخزون");
    assert.match(src, /موجودةٌ سلفاً في هذا المكتب/, "رسالةُ التكرار تغيّرت");
    assert.match(src, /status: 409/, "التكرارُ لا يُرَدّ بحالةٍ مميَّزة");
    // 🔑 ويعيد معرّفَ القائم كي تحوّل الواجهةُ الطلبَ إلى زيادةِ كميّة
    assert.match(src, /existingId: clash\.id/, "لا يُعاد معرّفُ الصفّ القائم");
    // 🔒 والمقارنةُ داخل المكتب وحدَه — فلكلّ مكتبٍ مخزنُه والاسمُ يتكرّر بينها بحقّ
    assert.match(src, /const clash = await prisma\.item\.findFirst\(/, "بنيةُ الفحص تغيّرت");
  });
});

describe("➕ النافذة: بحثٌ · اختيارٌ · أو اسمٌ جديد", () => {
  test("الاختيارُ يمرّ بمسار الزيادة القائم — فيرث حارسَ السعر وحسابَ المتوسّط", () => {
    const m = MODAL();
    assert.match(m, /await fetch\(`\/api\/items\/\$\{picked\.id\}`, \{\s*\r?\n?\s*method: "PUT"/,
      "الإضافةُ لمادّةٍ قائمةٍ لا تمرّ بمسار الزيادة");
    assert.match(m, /count: \(picked\.count \?\? 0\) \+ add, batchBuyPrice: price/,
      "الكميّةُ تُكتب مطلقةً بدل الرصيد+المضاف، أو سعرُ الدفعة لا يُرسَل");
    // 🔒 والسعرُ والكميّةُ مطلوبان في الواجهة أيضاً (والخادمُ يفرضهما على أيّ حال)
    assert.match(m, /if \(price <= 0\) \{ setErr\("أدخل سعر شراء هذه الدفعة"\); return; \}/, "السعرُ غيرُ مطلوبٍ في النافذة");
  });

  test("🔑 وزرُّ «مادّة جديدة» يظهر عند غياب **اسمٍ مطابقٍ تماماً** لا عند غياب النتائج", () => {
    // بحثٌ يعيد «كيبل ٥» لا يعني أنّ «كيبل» غيرُ موجودة — فالعبرةُ بالمطابقة لا بالتصفية
    const m = MODAL();
    assert.match(m, /norm\(i\.name \?\? ""\) === norm\(q\)/, "المطابقةُ التامّة سقطت ⇒ عرضُ إنشاءٍ لاسمٍ موجود");
    assert.match(m, /const canOfferNew = !!towerId && q\.trim\(\)\.length > 0 && !exact;/, "شرطُ عرض الإنشاء تغيّر");
    // ونموذجُ الجديد يحمل خياراتِ الإضافة كلَّها كما طلب («تبقى نفسُ خيارات الإضافة»)
    for (const f of ["سعر الشراء", "سعر البيع", "سعر بيع خاص", "التصنيف"]) {
      assert.ok(m.includes(f), `خيارُ «${f}» غائبٌ عن نموذج المادة الجديدة`);
    }
  });

  test("🔒 المكتبُ يُختار في النافذة، والقائمةُ تتبعه", () => {
    const m = MODAL();
    assert.match(m, /fetch\(`\/api\/items\?officeId=\$\{towerId\}`\)/, "القائمةُ لا تُقيَّد بالمكتب المختار");
    assert.match(m, /\}, \[towerId\]\);/, "تبديلُ المكتب لا يُعيد جلبَ القائمة ⇒ كميّاتُ مكتبٍ تُعرَض لآخر");
    assert.match(m, /setItems\(null\); setPicked\(null\); setCreating\(false\);/,
      "تبديلُ المكتب يُبقي اختياراً من مكتبٍ سابق ⇒ إضافةٌ إلى المكتب الخطأ");
  });
});

describe("✏️ «تعديل» عاد بسيطاً — عددٌ لا غير", () => {
  test("نموذجُ المدير كميّةٌ وحدَها، وزرُّ الإضافة المدمَج مُطفأ", () => {
    const p = PAGE();
    assert.match(p, /\? \[\{ name: "count", label: "الكمية \(تصحيح — زيادة أو نقصان\)", type: "number", required: true \}\]/,
      "نموذجُ تعديل المدير ما زال يحمل الأسعارَ والاسم");
    assert.match(p, /canAdd=\{false\}/, "زرُّ الإضافة المدمَج ما زال يعمل ⇒ بابانِ للإضافة");
    assert.match(p, /\{isAdmin && \(\s*\r?\n\s*<button\s*\r?\n\s*onClick=\{\(\) => setAddOpen\(true\)\}/,
      "زرُّ النافذة الجديدة يظهر لغير المدير — والقرارُ أنّه للمدير وحدَه");
  });

  test("🔑 والاسمُ صار اختياريّاً في التعديل — وإلّا رُدَّ كلُّ تصحيحِ عدد", () => {
    assert.match(PUT(), /name: z\.string\(\)\.min\(1, "اسم المادة مطلوب"\)\.optional\(\),/,
      "اشتراطُ الاسم عاد ⇒ «اسم المادة مطلوب» في وجه كلّ تصحيحِ كميّة");
  });

  test("🔒 وتصحيحُ المدير بلا سعرٍ لا يُحرّك المتوسّط — والمستخدمُ يبقى مُطالَباً بالسعر", () => {
    const src = PUT();
    // تصحيحٌ بلا سعر ⇒ الكلفةُ كما هي (القطعُ المضافةُ تُقوَّم بمتوسّط ما في يده)
    assert.match(src, /if \(isIncrease && hasBatchPrice\) \{/,
      "زيادةُ المدير بلا سعرٍ تُصفّر المتوسّطَ أو تُفسده");
    assert.match(src, /const hasBatchPrice = batchBuyPrice != null && Number\.isFinite\(batchBuyPrice\) && batchBuyPrice > 0;/,
      "تمييزُ «بسعرٍ / بلا سعر» سقط");
    // 🔒 ومسارُ المستخدم العاديّ ما زال يفرض السعر — فهو بابُه الوحيد إلى المخزن
    assert.match(src, /const bad = requireBatchPrice\(current, q\.data\.count, q\.data\.batchBuyPrice\);/,
      "🔴 سقط شرطُ السعر عن المستخدم العاديّ ⇒ تدخل بضاعتُه بلا سعرٍ أبداً");
  });
});
