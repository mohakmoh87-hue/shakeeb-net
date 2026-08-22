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

  test("⑦-أ صفرُ لمسٍ لمسارات الحذف الأربعة — شرطُ محمد «لا تؤثّر على الأكواد القائمة»", () => {
    // الإرجاعُ يشتقّ كلَّ شيءٍ ممّا هو محفوظٌ أصلاً، فلا سطرَ واحدٌ أُضيف إلى مسارات الحذف
    for (const rel of [
      "src/app/api/subscription-entries/[id]/void/route.ts",
      "src/app/api/money/[id]/void/route.ts",
      "src/app/api/invoices/[id]/void/route.ts",
      "src/app/api/manager-accounts/tx/route.ts",
    ]) {
      const src = read(rel);
      // المقياسُ ما تكتبه `data` لا ما ترشِّحه `where` (مسارات الحذف تشترط isDeleted: false
      // في `where` كي لا تحذف محذوفاً — وذاك حذفٌ لا استرجاع)
      assert.equal(/data:\s*\{\s*isDeleted:\s*false/.test(src), false,
        `مسارُ حذفٍ صار يكتب استرجاعاً: ${rel}`);
      assert.equal(src.includes("restoreReceipt"), false, `مسارُ الحذف صار يستورد محرّكَ الإرجاع: ${rel}`);
      assert.equal(src.includes("receipt_voids"), false, `أُقحم جدولُ لقطةٍ في مسار الحذف: ${rel}`);
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

// ═════ ♻️ المرحلةُ الثانية: الإرجاع «كأنّه لم يُحذف بكلّ تأثيراته» ═════
//
// مسحٌ عدائيٌّ بـ٢٢ عميلاً أحصى ٢١ حالةً يُفسد فيها الإرجاعُ الساذجُ بياناتٍ قائمة.
// وهذه الحرّاسُ تُثبّت العلاجَ الذي بُني لكلٍّ منها — فلا يسقط في تعديلٍ لاحق.

const ENGINE = () => read("src/app/api/_lib/restoreReceipt.ts");
const RAPI = () => read("src/app/api/deleted-receipts/restore/route.ts");

describe("♻️ إرجاعُ الوصل المحذوف · المرحلة ٢", () => {
  test("🔒 الصلاحيّةُ نفسُها، والحرسُ قبل أوّل نداءِ قاعدة، والمانعُ يردّ 409 لا 200", () => {
    const api = RAPI();
    assert.match(api, /guard\("receipts\.deleted"\)/, "مسارُ الإرجاع بلا صلاحيّة");
    const body = api.slice(api.indexOf("export async function POST"));
    assert.ok(body.indexOf('guard("receipts.deleted")') < body.indexOf("restoreReceipt("),
      "الحرسُ بعد التنفيذ لا قبله");
    assert.match(api, /status: res\.ok \? 200 : 409/, "المانعُ يُعاد بحالةِ نجاحٍ كاذبة");
    // ونوعُ الوثيقة ورقمُها يُتحقَّق منهما قبل أيّ عمل
    assert.match(api, /DEL_KINDS\.includes\(kind as DelKind\)/, "نوعٌ غريبٌ يمرّ بلا تحقّق");
  });

  test("🔎 dryRun يعرض الخطّةَ بلا كتابةِ حرف", () => {
    const eng = ENGINE();
    // في كلّ فرعٍ: رجوعٌ مبكّرٌ عند dryRun **قبل** فتح المعاملة
    const branches = eng.split("prisma.$transaction");
    assert.ok(branches.length >= 5, "أفرعُ الإرجاع الأربعةُ ليست كلُّها في معاملات");
    for (const b of branches.slice(0, 4)) {
      assert.match(b, /if \(dryRun/, "فرعٌ يكتب بلا رجوعٍ مبكّرٍ عند dryRun");
    }
  });

  test("⛔ الموانعُ التسعةُ حاضرةٌ بأسبابها المكتوبة", () => {
    const eng = ENGINE();
    for (const code of [
      "not_found", "not_deleted", "purged", "duplicate", "card_taken",
      "salary_locked", "linked_doc_deleted", "invoice_reverse", "sale_reverse", "pair_missing",
    ]) {
      assert.ok(eng.includes(`"${code}"`), `المانعُ ${code} غائب`);
    }
    // ومانعانِ فقط يقبلان الإقرارَ الصريح — والباقي قاطع
    assert.match(eng, /code: "duplicate",[\s\S]{0,260}override: true/, "ازدواجُ الوصل صار مانعاً قاطعاً أو بلا إقرار");
    assert.match(eng, /code: "card_taken",[\s\S]{0,260}override: true/, "سرقةُ الكارت بلا إقرار");
    assert.match(eng, /code: "salary_locked",[\s\S]{0,260}override: false/, "قفلُ الراتب صار قابلاً للتجاوز");
  });

  test("💰 المالُ يُحيا بحركات **هذا الحذف** لا بالترشيح — وإلّا أُحيي ما أطفأه إبطالٌ آخر", () => {
    const eng = ENGINE();
    assert.match(eng, /SAME_TX_MS = 15_000/, "نافذةُ «نفس المعاملة» غائبة");
    assert.match(eng, /Math\.abs\(t\.updatedAt\.getTime\(\) - voidAt\) <= SAME_TX_MS/,
      "حركاتُ المال تُحيا بالترشيح وحدَه ⇒ زيادةُ مالٍ صامتة");
    // ولا تُحيا حركةٌ دخلت كشفَ راتبٍ أو تسديدَ مكتب
    assert.match(eng, /salaryStatementId != null \|\| t\.settledAt != null/, "قيدٌ مقفلٌ بكشفٍ يُحيا بلا مانع");
  });

  test("📅 التاريخُ لا يرجع للوراء أبداً · والدَّينُ بزيادةٍ ذرّيّة", () => {
    const eng = ENGINE();
    assert.match(eng, /!sub\?\.dateTo \|\| sub\.dateTo < entry\.dateTo/,
      "الإرجاعُ قد يُرجع انتهاءَ المشترك إلى الوراء");
    assert.match(eng, /data\.carry = \{ increment: debtAdded \}/,
      "الدَّينُ يُكتب مطلقاً لا بزيادةٍ ذرّيّة (يمحوه تفعيلٌ متزامن)");
  });

  test("🎁 صفُّ عكسِ المكافأة يُحذف عند الإرجاع — وإلّا بقي رصيدٌ ممنوحٌ بلا وصل", () => {
    const eng = ENGINE();
    assert.match(eng, /rewardLog\.delete\(\{ where: \{ id: rev\.id \} \}\)/,
      "صفُّ العكس يبقى ⇒ حذفٌ قادمٌ يظنّ المكافأةَ معكوسةً فلا يعكسها");
    assert.match(eng, /rewardBalance: \(s\?\.rewardBalance \?\? 0\) \+ rev\.amount/, "الرصيدُ لا يعود");
    assert.match(eng, /rewardGrantCount: \(s\?\.rewardGrantCount \?\? 0\) \+ 1/, "عدّادُ المنح لا يعود");
  });

  test("🧾 الفاتورةُ المحذوفةُ بأثرٍ ماليّ **تُمنع** — وقيدُ الصندوق يُوجَّه لوثيقته", () => {
    const eng = ENGINE();
    // القياسُ داخل فرع الفاتورة وحدَه — لا في الملفّ كلِّه
    const invBranch = eng.slice(eng.indexOf('if (kind === "invoice")'), eng.indexOf('if (kind === "money")'));
    assert.ok(invBranch.length > 200, "فرعُ الفاتورة لم يُعثَر عليه — تغيّرت البنية");
    assert.match(invBranch, /if \(mode === "reverse"\)/, "فرعُ الفاتورة لا يميّز الحذفَ العكسيّ");
    assert.match(invBranch, /code: "invoice_reverse"/,
      "إرجاعُ فاتورةٍ عكسيّةٍ مسموح ⇒ فاتورةٌ فارغةٌ ومخزنٌ سالب");
    assert.match(eng, /fail\("linked_doc_deleted"/, "قيدُ مالٍ لوثيقةٍ محذوفةٍ يُرجَع وحدَه ⇒ استرجاعٌ نصفيّ");
    // 🔴 ولا يُعلَّق هذا الفحصُ على طريقة الحذف: حركاتُ الوصل تُطفأ **بلا قيدِ تدقيق**
    //   فيخرج mode = null — وهي أخطرُ الحالات. (اصطادته تجربةُ dryRun على الإنتاج.)
    const moneyBranch = eng.slice(eng.indexOf('if (kind === "money")'), eng.indexOf("④"));
    assert.ok(moneyBranch.length > 200, "فرعُ قيد الصندوق لم يُعثَر عليه");
    const linkCheck = moneyBranch.slice(moneyBranch.indexOf("if (tx.sourceId)"), moneyBranch.indexOf('fail("linked_doc_deleted"'));
    assert.equal(/mode === "reverse"/.test(linkCheck), false,
      "فحصُ الوثيقة المرتبطة معلَّقٌ على «حُذف عكسيّاً» ⇒ يمرّ الاسترجاعُ النصفيّ حين لا قيدَ تدقيقٍ للحركة");
    // وزوجُ التحويل: الشقّان معاً أو لا شيء
    assert.match(eng, /fail\("pair_missing"/, "شقُّ تحويلٍ يُرجَع وحدَه ⇒ مالٌ من العدم");
    assert.match(eng, /const ids = pairId \? \[id, pairId\] : \[id\]/, "الشقّان لا يُرجَعان في كتابةٍ واحدة");
  });

  test("🔒 كلُّ كتابةٍ تُعيد شرطَ النطاق — ولا كتابةَ بالمعرّف وحدَه", () => {
    const eng = ENGINE();
    const writes = eng.match(/t\.\w+\.update(Many)?\(\{[\s\S]{0,200}?\}\)/g) ?? [];
    assert.ok(writes.length >= 5, "كتاباتُ الإرجاع أقلُّ من المتوقّع — تغيّرت البنية");
    for (const w of writes) {
      const scoped = /\.\.\.scope/.test(w) || /agentId/.test(w) || /where: \{ id: cardId, agentId/.test(w) ||
        /rewardLog/.test(w) || /subscriber\.update\(\{ where: \{ id: entry\.subscriberId \}/.test(w);
      assert.ok(scoped, `كتابةٌ بلا شرطِ نطاق:\n${w}`);
    }
    // والفشلُ يُبطل كلَّ شيء: الكتابةُ داخل معاملةٍ وترمي إن لم يتغيّر صفّ
    assert.match(eng, /if \(up\.count === 0\) throw new Error/, "كتابةٌ لا تتحقّق من أنّها أصابت صفّاً");
  });

  test("📜 كلُّ إرجاعٍ يترك أثراً — RESTORE_RECEIPT بالتفاصيل وبالإقرار إن كان", () => {
    const eng = ENGINE();
    const hits = eng.match(/action: "RESTORE_RECEIPT"/g) ?? [];
    assert.equal(hits.length, 4, `أفرعُ الإرجاع الأربعةُ ليست كلُّها موثَّقة (${hits.length}/4)`);
    assert.match(eng, /إقرارٌ صريح: \$\{overrides\.join\(","\)\}/, "الإقرارُ الصريحُ لا يُوثَّق");
  });
});
