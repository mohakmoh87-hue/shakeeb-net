import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ الأربعةُ الحرِجة من المسح العدائيّ (2026-08-19) — حراسٌ نصّيّون ═════
// كلٌّ منها مالٌ يضيع أو يُختلَق؛ والاختبارُ يحرس بقاءَ الإصلاح فلا يعود بدمجٍ أو سكربت.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("حرِجة ١ · حذفُ حركة تسديد المكتب يُرفَض", () => {
  test("void يرفض office-settle ولا يسقط إلى الحذف الأعمى", () => {
    const c = code("src/app/api/money/[id]/void/route.ts");
    assert.ok(/sourceType === "office-settle"/.test(c), "لا حارسَ لـoffice-settle — يُحذَف أعمى فيتبخّر الطرفان");
    // الرفضُ قبل الحذف: يجب أن يعود بـ400 قبل بلوغ update({isDeleted:true})
    const idx = c.indexOf('office-settle');
    const del = c.indexOf('isDeleted: true } });');
    assert.ok(idx > 0 && idx < del, "حارسُ office-settle بعد الحذف الأعمى — لا ينفع");
  });
});

describe("حرِجة ٢ · تسديدان متزامنان لا يختلقان مالاً", () => {
  test("القراءةُ داخل المعاملة + updateMany مشروطٌ بـsettledAt:null + فحصُ العدّ", () => {
    const c = code("src/app/api/money/settlements/route.ts");
    assert.ok(/settledAt: null,\s*\n?\s*\},\s*\n?\s*data: \{ settledAt: now/.test(c) ||
              /id: \{ in: fresh\.map\(\(r\) => r\.id\) \}, settledAt: null \}/.test(c),
      "الوسمُ لا يشترط settledAt:null — تسديدان يختلقان مالاً");
    assert.ok(/stamp\.count !== fresh\.length/.test(c), "لا فحصَ لعددِ الموسوم — السباقُ يمرّ");
    assert.ok(/SETTLE_CONFLICT/.test(c), "لا إلغاءَ عند اكتشاف التزامن");
  });
});

describe("حرِجة ٣ · دَينُ carry ذرّيٌّ في المسارات الأربعة", () => {
  const sites: [string, RegExp, string][] = [
    ["src/app/api/subscribers/[id]/activate/route.ts", /carry: \{ increment: fullPaid \? 0 : grandTotal - paid \}/, "التفعيل"],
    ["src/app/api/debts/[id]/pay/route.ts", /carry: \{ decrement: amount \}/, "تسديد الدين"],
    // (مسارُ الاشتراكات: أُزيل POST الموروثُ كاملاً — عالٍ أ — يُحرَس أدناه بغياب أيّ كتابة)
    ["src/app/api/invoices/route.ts", /carry: \{ increment: remainder \}/, "الفواتير بالدين"],
  ];
  for (const [file, re, label] of sites) {
    test(`${label}: يكتب carry ذرّيّاً لا قيمةً مطلقة`, () => {
      const c = code(file);
      assert.ok(re.test(c), `${label}: carry ما زال يُكتَب مطلقاً — تسديدٌ متزامنٌ يمحو الدفعة`);
    });
  }
  test("لا كتابةَ carry مطلقةً في `data:{}` أيّ مسار (وحقلُ رسالةِ الواتساب مستثنى)", () => {
    // نفحص كتابةَ **العمود** فقط: `carry:` داخل كائن `data:` لتحديث المشترك — لا حقلَ
    // القالب في sendActivationMessage (قيمةٌ للعرض لا للقاعدة).
    for (const [file] of sites) {
      const c = code(file).replace(/sendActivationMessage\(\{[\s\S]*?\}\);/g, ""); // أسقِط وسائطَ الرسالة
      assert.ok(!/data: \{[\s\S]*?\bcarry: (?:newCarry|calc\.newCarry|\(subscriber)/.test(c),
        `${file}: كتابةُ carry مطلقةٌ عادت داخل data:`);
    }
  });
});

describe("أ+٣ · مسارُ الاشتراكات الموروث", () => {
  test("لا كتابةَ carry فيه إطلاقاً (أُزيل POST — عالٍ أ)", () => {
    const c = code("src/app/api/subscriptions/route.ts");
    assert.ok(!/carry:/.test(c), "عادت كتابةُ carry في المسار الموروث");
  });
});

describe("حرِجة ٤ · شقُّ زوجِ التحويل لا يُحوَّل", () => {
  test("convertKind يرفض زوجَ التحويل بالمؤشّر المتبادل", () => {
    const c = code("src/app/api/_lib/convertKind.ts");
    assert.ok(/isTransferPair/.test(c), "لا حارسَ لزوج التحويل — يُقلَب قيدُ تفعيلٍ أجنبيّ");
    assert.ok(/other\.sourceId === tx\.id/.test(c), "التمييزُ ليس بالمؤشّر المتبادل — قد يلتبس بماستر تفعيلٍ حقيقيّ");
    // الحارسُ قبل التبديل (خارج المعاملة، قبل updateMany على sourceType)
    const guard = c.indexOf('isTransferPair');
    const claim = c.indexOf('updateMany');
    assert.ok(guard > 0 && guard < claim, "حارسُ الزوج بعد التبديل — فات الأوان");
  });
});
