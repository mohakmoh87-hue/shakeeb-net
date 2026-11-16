import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══ حفظُ المكتب: كلُّ مفتاحٍ يصل إلى `prisma.tower.update` لا بدّ أن يكون عموداً ═══
//
// 🔴 الحادثةُ المقيسة: نشرةُ 2026-10-28 أضافت خانةَ «أوقات العمل» إلى نموذج المكتب،
//   وأوقاتُ العمل جدولٌ جانبيٌّ (`tower_hours`) لا عمودٌ على `towers`. فأُضيف المفتاحُ
//   `hours` إلى تحقّقِ المسار ومرّ كما هو إلى `prisma.tower.update`، و`GET /api/towers`
//   يُرفق `hours` بكلّ صفٍّ دائماً والنموذجُ يُرسل حقولَه كاملةً ⇒ **كلُّ** حفظٍ لأيّ
//   مكتبٍ صار يرمي `PrismaClientValidationError` ⇒ ٥٠٠ ⇒ «فشل الحفظ» بلا سبب. ومضى
//   تسعةَ عشرَ يوماً حتّى بلّغ محمد، إذ لا يقع الفشلُ إلّا عند الحفظ وحدَه.
//
// فالقياسُ هنا بنيويٌّ لا نصّيّ: مفاتيحُ التحقّق تُقاس على أعمدةِ `Tower` في
// `schema.prisma`، وما ليس عموداً يُشترَط نزعُه قبل الاستعلام.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function towerColumns(): Set<string> {
  const schema = read("prisma/schema.prisma");
  const block = /^model Tower \{$([\s\S]*?)^\}$/m.exec(schema);
  assert.ok(block, "لم يُعثر على نموذج Tower في schema.prisma");
  const cols = new Set<string>();
  for (const line of block[1].split("\n")) {
    const m = /^\s{2}(\w+)\s+\w/.exec(line);
    if (m) cols.add(m[1]);
  }
  return cols;
}

function schemaKeys(src: string): string[] {
  const block = /const schema = z\.object\(\{([\s\S]*?)^\}\);$/m.exec(src);
  assert.ok(block, "لم يُعثر على مُخطَّط التحقّق في المسار");
  return [...block[1].matchAll(/^\s{2}(\w+):\s/gm)].map((m) => m[1]);
}

describe("🏢 حفظُ المكتب — مفاتيحُ التحقّق أعمدةٌ حقيقيّة", () => {
  test("🔴 كلُّ مفتاحٍ ليس عموداً على towers يُنزَع قبل prisma.tower.update", () => {
    const src = read("src/app/api/towers/[id]/route.ts");
    const cols = towerColumns();
    const stray = schemaKeys(src).filter((k) => !cols.has(k));
    for (const k of stray) {
      assert.ok(
        new RegExp(`delete data\\.${k}\\b`).test(src),
        `المفتاحُ «${k}» ليس عموداً على towers ولا يُنزَع — فكلُّ حفظِ مكتبٍ سيفشل بـ٥٠٠`,
      );
    }
  });

  test("أوقاتُ العمل تُنزَع من الاستعلام وتُكتب في جدولها الجانبيّ", () => {
    const src = read("src/app/api/towers/[id]/route.ts");
    assert.ok(/delete data\.hours\b/.test(src), "hours لم تُنزَع من حمولة التحديث");
    assert.ok(src.includes("setTowerHours("), "كتابةُ أوقات العمل في جدولها سقطت");
    assert.ok(!towerColumns().has("hours"), "hours صار عموداً — يُراجَع هذا الحارس");
  });

  test("مسارُ الإنشاء لا يُمرِّر hours إلى prisma.tower.create", () => {
    const src = read("src/app/api/towers/route.ts");
    const strayInCreate = schemaKeys(src).filter((k) => !towerColumns().has(k));
    assert.deepEqual(strayInCreate, [], `مفاتيحُ غيرُ أعمدةٍ في مسار الإنشاء: ${strayInCreate.join(", ")}`);
  });
});
