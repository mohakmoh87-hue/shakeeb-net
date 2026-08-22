import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🗑️ سجلُّ الوصولات المحذوفة — المرحلةُ الأولى (طلبُ محمد 2026-08-22) ═════
//
// بنصّه: «بدل هذا العناء كلّه لم لا نضع سجل الوصولات المحذوفة وفيه كل وصل حذف من كل مكان
// … ويكون مكانه في القائمة الجانبيه في قائمة النظام … وايضا فيه بحث بين تاريخين وبحث عن
// كلمة او مكتب او نوع الوصل تفعيل فاتورة مبيع وغيرها».
//
// وحدُّ المرحلة الأولى **قراءةٌ محضة** — والحرّاسُ هنا يمنعون انحرافَها:
//  ① صفرُ كتابةٍ في المسار ومكتبته (زرُّ الإرجاع مرحلةٌ ثانيةٌ بحُرّاسها).
//  ② حدودُ السجلّ التي أملاها محمد: تسديدُ الدين ووصلُ «ديون سابقة» خارجه.
//  ③ العزلُ في جملة الاستعلام نفسِها لكلّ مصدرٍ من الأربعة.
//  ④ نافذةُ اليوم بتوقيت بغداد (ب-٨) لا ببناءٍ يدويّ.
//  ⑤ الصلاحيّةُ باسمها الذي أملاه محمد، وبندُ القائمة في مجموعة «النظام».

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const LIB = () => read("src/app/api/_lib/deletedReceipts.ts");
const API = () => read("src/app/api/deleted-receipts/route.ts");

describe("🗑️ سجلُّ الوصولات المحذوفة · المرحلة ١", () => {
  test("① قراءةٌ محضة — صفرُ كتابةٍ في المسار ومكتبته", () => {
    for (const [name, src] of [["route", API()], ["lib", LIB()]] as const) {
      for (const write of ["update(", "updateMany(", "create(", "createMany(", "delete(", "deleteMany(", "$executeRaw", "upsert("]) {
        assert.equal(src.includes(`.${write}`), false,
          `المرحلةُ الأولى قراءةٌ محضة — ووجدتُ كتابةً (${write}) في ${name}`);
      }
    }
  });

  test("② حدودُ السجلّ: تسديدُ الدين ووصلُ «ديون سابقة» خارجه", () => {
    const lib = LIB();
    // تسديدُ دين المشترك ودينِ الفاتورة كلاهما قيدٌ نوعُه debt/master-debt — قرارُ محمد
    assert.match(lib, /DEBT_SOURCES = \["debt", "master-debt"\]/, "أنواعُ التسديد غيرُ معرَّفةٍ للاستثناء");
    assert.match(lib, /sourceType: \{ notIn: DEBT_SOURCES \}/, "قيودُ التسديد ما زالت تدخل السجلّ");
    // والعمودُ يقبل NULL: لولا فرعُ `sourceType: null` لسقطت المصروفاتُ والمقبوضاتُ اليدويّة
    assert.match(lib, /\{ sourceType: null \}/, "قيودُ المصروف/المقبوض اليدويّة تسقط بسبب NOT IN على عمودٍ يقبل NULL");
    // ووصلُ «إضافة ديون سابقة» دَينٌ لا وصلٌ مقبوض
    assert.match(lib, /DEBT_CARD_TYPE = "ديون سابقة"/, "وصلُ الدين غيرُ معرَّفٍ للاستثناء");
    assert.match(lib, /cardType: \{ not: DEBT_CARD_TYPE \}/, "وصلُ «ديون سابقة» ما زال يدخل السجلّ");
    // وهنا أيضاً فخُّ NULL: بلا فرعِ `cardType: null` تختفي وصولاتُ تفعيلٍ بلا نوعِ كارت
    assert.match(lib, /\{ cardType: null \}/, "وصلٌ بلا نوعِ كارتٍ يسقط من السجلّ (NOT على عمودٍ يقبل NULL)");
  });

  test("③ العزلُ في جملة الاستعلام — لكلّ مصدرٍ شرطُه الصحيح", () => {
    const lib = LIB();
    assert.match(lib, /agentTowerIds/, "لا تحديدَ لمكاتب الوكيل");
    // ثلاثةُ مصادرَ تحمل towerId، وحركةُ المدير لا تحمله ⇒ عزلُها بالوكيل
    assert.match(lib, /const scopeWhere = \{ towerId: \{ in: scope\.length \? scope : \[-1\] \} \}/,
      "نطاقُ المكاتب لا يرتدّ إلى [-1] عند الفراغ (وكيلٌ بلا مكاتب يرى كلَّ شيء)");
    assert.match(lib, /const agentId = session\?\.agentId \?\? -1/,
      "agentId بلا ارتدادٍ إلى -1: قيمةُ null تُنتج IS NULL فتكشف صفوفاً ليست له");
    assert.match(lib, /isDeleted: true,\s*\n\s*agentId,/, "حركةُ المدير بلا عزلِ وكيل");
    // ومكتبٌ غريبٌ لا يُقبل: يُفحَص أنّه من مكاتبه قبل استعماله
    assert.match(lib, /askTower && towerIds\.includes\(askTower\)/, "رقمُ المكتب يُقبل بلا تحقّقٍ من ملكيّته");
  });

  test("④ المدى بتوقيت بغداد (ب-٨) لا ببناءٍ يدويّ", () => {
    const lib = LIB();
    assert.match(lib, /import \{ baghdadStart, baghdadEnd \} from "@\/lib\/dayRange"/, "حدودُ اليوم ليست من dayRange");
    assert.equal(/setHours\(\s*23/.test(lib), false, "نهايةُ اليوم مبنيّةٌ يدويّاً ⇒ نافذةٌ مُزاحةٌ ٣ ساعات");
  });

  test("⑤ الصلاحيّةُ والقائمة — بالاسم الذي أملاه محمد", () => {
    const rbac = read("src/lib/rbac.ts");
    assert.match(rbac, /"receipts\.deleted"/, "المفتاحُ غائبٌ عن اتّحاد الصلاحيّات");
    assert.match(rbac, /\{ key: "receipts\.deleted", label: "سجل الوصولات المحذوفة" \}/,
      "الاسمُ العربيُّ الذي أملاه محمد غائبٌ عن قائمة الصلاحيّات");
    const shell = read("src/components/shell/AppShell.tsx");
    const sys = shell.slice(shell.indexOf('label: "النظام"'));
    assert.match(sys.slice(0, 600), /href: "\/deleted-receipts", perm: "receipts\.deleted"/,
      "بندُ الصفحة ليس داخل مجموعة «النظام»");
    // والمسارُ محروسٌ **قبل** أوّل نداءِ قاعدة
    const api = API();
    assert.match(api, /guard\("receipts\.deleted"\)/, "المسارُ بلا صلاحيّة");
    // المقارنةُ داخل جسم المعالج لا في الملفّ كلِّه — وإلّا قِيست بسطر الاستيراد
    const body = api.slice(api.indexOf("export async function GET"));
    assert.ok(body.indexOf('guard("receipts.deleted")') < body.indexOf("listDeletedReceipts("),
      "الحرسُ بعد الجلب لا قبله");
  });

  test("⑥ البحثُ الرباعيُّ الذي طلبه: مدى · كلمة · مكتب · نوع", () => {
    const api = API();
    for (const p of ["from", "to", "q", "tower", "kind"]) {
      assert.ok(api.includes(`sp.get("${p}")`), `معاملُ البحث «${p}» غيرُ مقروء`);
    }
    const lib = LIB();
    assert.match(lib, /DEL_KINDS: DelKind\[\] = \["activation", "invoice", "money", "manager"\]/,
      "أنواعُ الوثائق الأربعة غيرُ معرَّفة");
    // والمصادرُ الأربعةُ كلُّها تُقرأ فعلاً
    for (const m of ["subscriptionEntry.findMany", "invoice.findMany", "moneyTx.findMany", "managerTx.findMany"]) {
      assert.ok(lib.includes(`prisma.${m}`), `المصدرُ ${m} غيرُ مقروء`);
    }
  });

  test("⑦ «مَن حذف ومتى وكيف» يُقرأ من سجلّ التدقيق — ووصلُ الصندوق لا يضيع", () => {
    const lib = LIB();
    assert.match(lib, /action: "VOID_RECEIPT", entity: "subscriptionEntry"/, "قيدُ حذف الوصل غيرُ مقروء");
    assert.match(lib, /action: "VOID_RECEIPT", entity: "invoice"/, "قيدُ حذف الفاتورة غيرُ مقروء");
    assert.match(lib, /action: "VOID_MONEY", entity: "moneyTx"/, "قيدُ حذف قيد الصندوق غيرُ مقروء");
    // وصلٌ حُذف من شاشة الصندوق أثرُه في VOID_MONEY على حركته لا في قيدٍ خاصٍّ به
    assert.match(lib, /sourceType: "activation", sourceId: \{ in: entryIds \}/,
      "الوصلُ المحذوفُ من الصندوق يظهر بلا «مَن حذف»");
    // وطريقةُ الحذف تُقرأ من نصّ التدقيق كما يكتبه المساران حرفاً
    assert.match(lib, /includes\("بلا تأثير"\)/, "«بلا تأثيرٍ ماليّ» لا تُميَّز");
  });
});
