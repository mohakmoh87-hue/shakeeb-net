import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ الحاسبة المزدوجة + المحذوفة تعود (طلبُ محمد 2026-08-19) ═════
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("صرفُ الحاسبة المحظورة — لا تعود", () => {
  test("الحذفُ النهائيّ صرفٌ (updateMany + dismissedAt) لا مسحٌ (deleteMany)", () => {
    const c = code("src/app/api/hybrid/workers/route.ts");
    assert.ok(!/deleteMany\(/.test(c), "ما زال يمسح الصفَّ — فنبضةُ الجهاز تُعيده سليماً");
    assert.ok(/dismissedAt: new Date\(\)/.test(c), "الصرفُ لا يضع dismissedAt");
    assert.ok(/blocked: true, approved: false, dismissedAt/.test(c), "المصروفةُ يجب أن تبقى محظورةً — وإلّا أحيتها النبضة");
  });

  test("القائمةُ تُخفي المصروفة (blocked:true + dismissedAt:null)", () => {
    const c = code("src/app/api/hybrid/workers/route.ts");
    assert.ok(/blocked: true, dismissedAt: null/.test(c), "قائمةُ المحظور تعرض المصروفةَ — يريدها محمد مخفيّة");
  });

  test("النبضةُ لا تُحيي المصروفة: تحديثُها لا يمسّ blocked ولا dismissedAt", () => {
    const c = code("src/app/api/hybrid/heartbeat/route.ts");
    // update لا يحمل blocked ولا approved ولا dismissedAt — فالصفُّ المصروفُ يبقى كما هو
    const upd = c.match(/update: \{[^}]*\}/s)?.[0] ?? "";
    assert.ok(upd && !/blocked/.test(upd) && !/approved/.test(upd) && !/dismissedAt/.test(upd),
      "نبضةٌ تمسّ blocked/approved/dismissedAt ستُحيي حاسبةً صُرفت");
  });
});

describe("الحاسبة المزدوجة — مُعرِّفٌ ثابت", () => {
  test("المُنصِّبُ يأخذ MachineGuid الثابتَ لا GUID عشوائيّاً لكلّ تنصيب", () => {
    const c = read("src/app/api/hybrid/setup.ps1/route.ts");
    assert.ok(/MachineGuid/.test(c), "المُعرِّفُ ليس مُعرِّفَ الجهاز الثابت — فكلُّ تنصيبٍ يولّد حاسبةً جديدة");
    // ويبقى الاحتياطُ العشوائيّ إن تعذّرت قراءةُ السجلّ
    assert.ok(/\[guid\]::NewGuid/.test(c), "لا احتياطَ عند تعذّر قراءة MachineGuid");
  });

  test("🔒 الحاسباتُ القائمةُ محفوظة: MACHINE_ID الموجودُ يُبقى دائماً", () => {
    const c = read("src/app/api/hybrid/setup.ps1/route.ts");
    assert.ok(/if \(-not \(\$keep \| Where-Object \{ \$_ -match '\^MACHINE_ID=' \}\)\)/.test(c),
      "شرطُ حفظ MACHINE_ID القائم غاب — قد يُبدَّل مُعرِّفُ حاسبةٍ عاملة");
  });
});
