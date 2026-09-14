import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ اسمُ الدخول فريدٌ عبر المستخدمين والفنيّين معاً (2026-09-14) ═════
// مديرُ «new day» أُنشئ باسم `moh` وهو اسمُ فنيٍّ لدى كاسبر ⇒ الدخولُ يجد المستخدمَ أوّلاً فلا يصل
// الفنيُّ أبداً، ومحاولاتُه تقفل حسابَ مديرِ وكيلٍ آخر.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("اسمُ الدخول فريدٌ عبر الجدولين", () => {
  test("الفاحصُ المشترك يفحص المستخدمين والفنيّين", () => {
    const c = code("src/lib/usernameTaken.ts");
    assert.ok(/prisma\.user\.findFirst/.test(c), "لا يفحص المستخدمين");
    assert.ok(/prisma\.technician\.findFirst/.test(c), "لا يفحص الفنيّين");
  });

  const paths = [
    "src/app/api/users/route.ts",
    "src/app/api/users/[id]/route.ts",
    "src/app/api/auth/trial-signup/route.ts",
    "src/app/api/owner/agents/route.ts",
    "src/app/api/field/technicians/route.ts",
  ];
  for (const p of paths) {
    test(`${p} يستعمل الفاحصَ المشترك`, () => {
      const c = code(p);
      assert.ok(/from "@\/lib\/usernameTaken"/.test(c), "لا يستورد الفاحصَ المشترك");
      assert.ok(/await usernameTaken\(/.test(c), "لا يفحص الاسمَ قبل الحفظ");
      assert.ok(!/user\.findUnique\(\{\s*where:\s*\{\s*username/.test(c), "عاد فحصُ المستخدمين وحدَهم — يُقبل اسمُ فنيّ");
    });
  }
});
