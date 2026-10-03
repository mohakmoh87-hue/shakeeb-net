import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ حارسا كاشف التنصيبات (قرارُ محمد 2026-10-03) ═════
// حادثة: تغيَّرت أسماءُ باقات الساس إلى الأربع الجديدة، وبقي الاسمُ القديمُ محفوظاً في سجلّ
// المزامنة شهوراً (التطابقُ يمنع كتابةَ سطرٍ جديد) ⇒ كلُّ تجديدٍ عاديٍّ صار «عرضاً» ثمّ
// تنصيباً خارجيّاً: ١٦٠١ صفٍّ وهميٍّ أُبطلت، وأكبرُها كاسبر.
const code = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("كاشفُ التنصيبات لا يحكم باسمٍ ميّت", () => {
  const c = code("src/lib/installDetect.ts");
  test("① الوكيلُ صاحبُ العقود لا يعمل عنده الكاشف", () => {
    assert.ok(/contractInstall\.count\(\{ where: \{ agentId, classification: \{ not: "removed" \} \} \}\)/.test(c),
      "🔴 لا يُفحَص وجودُ بيانات العقود");
    assert.ok(/if \(contracts > 0\) return \[\];/.test(c), "🔴 الكاشفُ يعمل رغم وجود العقود — خارجيٌّ وهميّ");
  });
  test("② اسمُ الباقة يجب ألّا يكون أقدمَ من التفعيل", () => {
    assert.ok(/sas\."createdAt" >= en\.date - interval '7 days'/.test(c),
      "🔴 عاد الحكمُ باسمٍ قديم — أيُّ تغييرِ تسميةٍ يُحوّل التجديدات إلى تنصيبات");
    assert.ok(/DISTINCT ON \(sl\."subscriberId"\) sl\."subscriberId", sl\."packageName", sl\."createdAt"/.test(c),
      "تاريخُ الاسم لا يُقرأ أصلاً");
  });
  test("لا يعتمد على كلمةِ Offer (قد تتغيّر التسمية)", () => {
    assert.ok(!/offer/i.test(c.replace(/isOfferName/g, "")), "🔴 دخلت كلمةٌ ثابتةٌ في المنطق");
  });
});
