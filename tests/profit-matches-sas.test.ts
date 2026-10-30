import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ═════ 🎴 «التفعيلُ يُطابق الساس» — حرّاسُ قياسِ 2026-10-30 ═════
// قِيست أربعةُ مكاتبَ بملفّات تفعيلاتِ الساس للشهر العاشر (٧٩٦٨ صفّاً): الكروتُ
// المستهلكةُ ساوت التفعيلاتِ الحقيقيّةَ في كلّ مكتبٍ على حِدة، وبصفر سيريالٍ مكرَّر.
// وظهرت ثلاثُ علّاتٍ قِيس أثرُ كلٍّ منها، فهذه حرّاسُها كي لا تعود:
//   ① صفوفُ «ديونٍ سابقة» (moneyType=2) كانت تُحسَب تفعيلاتٍ بشهرٍ وربحٍ كامل.
//   ② مدّةُ التفعيل الخارجيِّ كانت تُقاس من انتهاءٍ قديمٍ قد يسبق التفعيلَ بسنوات
//      (صفٌّ واحدٌ حُسب ٥٢ شهراً) — والصحيحُ الأكبرُ بين القديم ولحظة التفعيل.
//   ③ نافذةُ منع التكرار ±٣٠ دقيقةً كانت تبتلع تفعيلَ الأشهر المتعدّدة: ثلاثةُ كروتٍ
//      بفارق ٦ ثوانٍ تُسجَّل واحداً. وقاعدةُ محمد: «كارتٌ مختلف ⇒ تفعيلٌ يُحسَب».

describe("🎴 أرباحُ الشركة تطابق تفعيلاتِ الساس", () => {
  test("① الدَّينُ ليس تفعيلاً — ويبقى دليلَ «له وصل»", () => {
    const src = read("src/lib/profits.ts");
    assert.match(src, /if \(e\.moneyType === 2\) continue;/,
      "🔴 صفوفُ الديون تُحسَب تفعيلاتٍ في «داخل المكتب»");
    // 🔒 ونافذةُ «له وصل» تبقى شاملةً الدَّينَ (نصُّ محمد: «بمبلغٍ مستلمٍ أو ديناً»)
    const near = src.slice(src.indexOf("const near = await"), src.indexOf("const allReceipts"));
    assert.ok(!/moneyType/.test(near),
      "🔴 الدَّينُ استُثني من دليل «له وصل» ⇒ تفعيلاتٌ داخليّةٌ ستنقلب خارجيّة");
  });

  test("② مدّةُ التفعيل من الأكبر بين الانتهاء القديم ولحظة التفعيل", () => {
    const src = read("src/lib/profits.ts");
    assert.match(src, /const base = Math\.max\(r\.oldSasDateTo\?\.getTime\(\) \?\? 0, at\.getTime\(\)\);/,
      "🔴 المدّةُ تُقاس من انتهاءٍ قديمٍ قد يسبق التفعيلَ بسنوات");
    assert.ok(!/r\.sasDateTo\.getTime\(\) - r\.oldSasDateTo\.getTime\(\)/.test(src),
      "🔴 الطرحُ المباشرُ من الانتهاء القديم عاد");
  });

  test("③ منعُ التكرار باللحظة نفسِها — فكارتٌ مختلفٌ يُحسَب", () => {
    const src = read("src/lib/syncLog.ts");
    assert.ok(!/30 \* 60_000/.test(src),
      "🔴 نافذةُ ±٣٠ دقيقةً عادت ⇒ تفعيلُ الأشهر المتعدّدة يُبتلَع");
    assert.ok(src.includes('kind, activatedAt: p.activatedAt }'),
      "🔴 حدثُ التفعيل لا يُميَّز بلحظته");
    assert.ok(src.includes('kind: "install", activatedAt: p.activatedAt }'),
      "🔴 تفعيلُ الشركة/الديلر لا يُميَّز بلحظته");
  });
});
