import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "src/lib/whatsapp.ts"), "utf8");

describe("تثبيتُ نسخة واتساب-ويب — طلبُ محمد 2026-11-24", () => {
  test("نسخةٌ مثبّتةٌ موجودةٌ في إعدادات العميل", () => {
    const m = src.match(/webVersion:\s*"([^"]+)"/);
    assert.ok(m, "لا نسخةَ مثبّتة — سيعود العميلُ لتحميل البناء الحيّ المعطوب");
    assert.match(m![1], /^\d+\.\d+\.\d+/);
  });

  test("المصدرُ بعيدٌ من مستودع wa-version — لا محلّيٌّ فارغٌ يسقط للحيّ", () => {
    assert.match(src, /webVersionCache:\s*{[\s\S]*?type:\s*"remote"/);
    assert.match(src, /wppconnect-team\/wa-version\/main\/html\/\{version\}\.html/);
  });

  test("النسخةُ المثبّتةُ ليست من البناءات التي حذف منها واتسابُ وحدةَ WAWebSocketModel", () => {
    const pinned = src.match(/webVersion:\s*"([^"]+)"/)![1];
    const build = Number(pinned.split(".")[2].split("-")[0]);
    assert.ok(build < 1056039834, `النسخة ${pinned} ضمن مدى البناءات المعطوبة`);
  });
});
