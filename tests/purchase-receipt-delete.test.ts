import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🗑️🏬 حذفُ وصل الشراء — الحرّاسُ البنيويّون (طلبُ محمد 2026-11-01) ═════
//
// الوصلُ الذي أُضيف بالخطأ لم يكن له مكانُ حذفٍ أصلاً، فحذفُ تسديده من حسابات المدير
// أبقى الوصلَ ديناً وموادَّه في المخزن. والمسارُ الجديد يحذفه ويُرجع موادَّه ويعكس
// تسديدَه — وهذه أفعالٌ ماليّةٌ ومخزنيّة، فتُحرَس بقواعدَ لا بأشكالِ أسطر.

const ROOT = path.resolve(import.meta.dirname, "..");
const ROUTE = path.join(ROOT, "src/app/api/purchase-receipts/[id]/route.ts");
const MODAL = path.join(ROOT, "src/components/PurchaseReceiptModal.tsx");
const src = fs.readFileSync(ROUTE, "utf8");
const modal = fs.readFileSync(MODAL, "utf8");
const del = src.slice(src.indexOf("export async function DELETE"));

describe("🗑️ حذفُ وصل الشراء", () => {
  test("الحذفُ خلف صلاحيّة «مسح الوصولات» وحدَها", () => {
    assert.match(del, /guard\("receipts\.void"\)/, "الحذفُ بلا صلاحيّةِ مسح الوصولات");
    const read = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function DELETE"));
    assert.match(read, /guard\("inventory\.manage"\)/, "قراءةُ التفاصيل بلا حارس");
  });

  test("كلُّ مسارٍ يتحقّق من الوكيل ومن ملكيّة المكتب", () => {
    for (const [name, part] of [["القراءة", src.slice(0, src.indexOf("export async function DELETE"))], ["الحذف", del]] as const) {
      assert.match(part, /agentId,\s*isDeleted: false/, `${name}: الوصلُ يُقرأ بلا عزلِ وكيل`);
      assert.match(part, /ownsTower\(g\.session/, `${name}: بلا تحقّقٍ من ملكيّة المكتب`);
    }
  });

  test("🔴 لا محوَ نهائيّاً — الشطبُ بالعلَم وحدَه", () => {
    assert.doesNotMatch(src, /\.delete(Many)?\s*\(/, "محوٌ نهائيٌّ في مسار الحذف");
    for (const t of ["purchaseReceipt", "itemBatch", "purchasePayment", "moneyTx", "managerTx"]) {
      assert.match(del, new RegExp(`${t}\\.update(Many)?\\(`), `${t}: لا شطبَ ناعماً`);
    }
  });

  test("ما بِيع منه لا يُحذف — البضاعةُ لا ترجع من فاتورةٍ قائمة", () => {
    assert.match(del, /remaining\s*<\s*b\.qty/, "لا فحصَ للمبيع قبل الحذف");
    const guardAt = del.search(/remaining\s*<\s*b\.qty/);
    const undoAt = del.indexOf("itemBatch.update");
    assert.ok(guardAt > 0 && guardAt < undoAt, "فحصُ المبيع بعد إرجاع المخزن — الأوانُ فات");
  });

  test("المخزنُ يُنقَص بقدرِ ما دخل بالوصل، ولا يُترَك سالباً", () => {
    assert.match(del, /count:\s*\{\s*decrement:\s*b\.qty\s*\}/, "النقصُ ليس بقدر دفعة الوصل");
    assert.match(del, /count:\s*0/, "لا حمايةَ من كميّةٍ سالبة");
  });

  test("التسديدُ القائم يُعكَس مرّةً واحدة — والمُبطَلُ سلفاً لا يُمَسّ", () => {
    assert.match(del, /purchasePayment\.findMany\([^)]*isDeleted: false/, "الدفعاتُ المُبطَلة تُعكَس ثانيةً ⇒ مالٌ يعود مرّتين");
    assert.match(del, /moneyTx\.updateMany\([^)]*isDeleted: false/, "حركةُ اليوميّ تُشطب بلا شرط");
    assert.match(del, /managerTx\.updateMany\([^)]*agentId/, "حركةُ الكلّيّ بلا عزلِ وكيل");
  });

  test("المادّةُ لا تُشطب إلّا إن كانت فارغةً بلا دفعةٍ ولا بيعٍ ولا فاتورة", () => {
    const fn = del.slice(del.indexOf("const droppable"), del.indexOf("let droppedItems"));
    for (const t of ["itemBatch.count", "saleConsumption.count", "invoiceItem.count"]) {
      assert.ok(fn.includes(t), `شرطُ شطبِ المادّة لا يفحص ${t}`);
    }
    assert.match(fn, /count\s*\?\?\s*0\)\)\s*>\s*0\) return false/, "مادّةٌ بكميّةٍ قد تُشطب");
  });

  test("نظائرُ الاسم تُشطب داخل مكاتب الوكيل وحدَها", () => {
    assert.match(del, /towerId:\s*\{\s*in:\s*agentOffices\s*\}/, "شطبُ النظائر بلا حصرٍ بمكاتب الوكيل");
    assert.match(del, /tower\.findMany\(\{\s*where:\s*\{\s*agentId/, "مكاتبُ الوكيل تُقرأ بلا عزل");
  });

  test("الزرُّ في الواجهة خلف الصلاحيّة نفسِها", () => {
    assert.match(modal, /can\("receipts\.void"\)/, "زرُّ الحذف بلا شرطِ صلاحيّة");
    const btn = modal.slice(modal.indexOf("canDelete &&"));
    assert.match(btn.slice(0, 400), /method:\s*"DELETE"|remove\(r\)/, "زرٌّ بلا فعلِ حذف");
  });
});
