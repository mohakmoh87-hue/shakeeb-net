import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const IMP = () => read("src/app/api/sas4/import/route.ts");

describe("🏷️ وسمُ القدامى بلوحتهم عند الاستيراد — حالةُ كاسبر 2026-08-26", () => {
  test("القائمُ الذي ظهر في قائمة اللوحة يُوسَم بها — والفارغُ حصراً", () => {
    const src = IMP();
    assert.match(src, /sasPanelId: null, isDeleted: false \},\s*\r?\n\s*data: \{ sasPanelId: panelId \}/,
      "🔴 الوسمُ يشمل موسوماً سلفاً — حسابٌ أبٌ يخطف يوزرات الابن بعد وسمها الصحيح");
    assert.match(src, /if \(panelId != null && existingIds\.size\)/,
      "الوسمُ يجري بلا لوحةٍ مختارة أو بلا قائمين — عبثٌ أو أخطاء");
    assert.match(src, /where: \{ towerId, sasId: \{ in: ids\.slice\(i, i \+ 1000\) \}/,
      "الوسمُ بلا تقييد المكتب أو بلا تقطيعٍ للدفعات");
  });

  test("والنتيجةُ تُقال: stamped في الردّ والأثر — والجديدُ ما زال يُوسَم عند إنشائه", () => {
    const src = IMP();
    assert.match(src, /return NextResponse\.json\(\{ ok: true, created, skipped, stamped \}\);/, "عدّادُ الوسم لا يُعاد");
    assert.match(src, /ووُسم \$\{stamped\} مشتركاً قائماً/, "الأثرُ لا يذكر الوسم");
    assert.match(src, /sasPanelId: panelId,\s*\r?\n\s*packageId: pkgId/, "وسمُ الجديد عند الإنشاء سقط");
    // 🔒 وحرسُ اللوحة كما هو: تتبع هذا المكتبَ حكماً في الخادم
    assert.match(src, /لوحةُ الساس لا تتبع هذا المكتب/, "حارسُ ملكيّة اللوحة سقط");
  });
});
