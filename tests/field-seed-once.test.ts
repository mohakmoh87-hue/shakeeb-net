import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ أ-٣ · الأعمدةُ الافتراضيّة تُزرَع مرّةً واحدةً ولا تعود ═══════
//
// «إن حذفها الوكيل لا تعود، وإن غيّر اسمَها لا يرجع الاسمُ الأصليّ — فهي ليست إلزاميّةً
// بحال». فالغيابُ بعد الزرع الأوّل قرارٌ لا نقصٌ يُصلَح.
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SEED = "src/app/api/_lib/fieldSeed.ts";

describe("أ-٣ · زرعُ الأعمدة الافتراضيّة مرّةً واحدة", () => {
  test("🔑 علامةُ ختمٍ للوكيل — وبعدها لا يُنادى الإصلاحُ الكسولُ أبداً", () => {
    const src = read(SEED);
    assert.ok(/fieldSeeded:\$\{agentId\}/.test(src), "لا علامةَ ختمٍ للوكيل");
    // ensureFieldDefaults (المُعيدُ للناقص) يُنادى فقط في فرع «غير مختوم»
    assert.ok(/if \(!agentSealed\) \{[\s\S]*?ensureFieldDefaults\(agentId\)/.test(src), "الإصلاحُ الكسول يُنادى ولو كان الوكيلُ مختوماً");
  });

  test("🆕 ولوحةُ مكتبٍ جديدٍ بعد الختم تأخذ أعمدتَها مرّةً ثمّ تُختم هي الأخرى", () => {
    const src = read(SEED);
    assert.ok(/fieldSeeded:board:\$\{boardId\}/.test(src), "لا علامةَ ختمٍ للّوحة — مكتبٌ جديدٌ يبقى بلا أعمدة أو تُعاد أعمدتُه للأبد");
    assert.ok(/STANDARD_OPS/.test(src), "أعمدةُ اللوحة الجديدة ليست القياسيّةَ الخمس");
  });

  test("🔒 ولا يمسّ src/lib — فذلك يُعيد تشغيل عمّال الحاسبات", () => {
    // الغلافُ في src/app، وfieldDefaults.ts نفسُه بقي كما هو (يستوردُه الغلافُ فقط)
    const lib = read("src/lib/fieldDefaults.ts");
    assert.ok(!lib.includes("fieldSeeded"), "منطقُ الختم تسرّب إلى src/lib");
  });

  test("⛓️ والمستدعيان القديمان صارا على الغلاف", () => {
    assert.ok(read("src/app/api/field/board/route.ts").includes("ensureFieldDefaultsOnce"), "لوحةُ الفنيين ما زالت على الإصلاح الكسول");
    assert.ok(read("src/app/api/field/card-types/route.ts").includes("ensureFieldDefaultsOnce"), "أنواعُ البطاقات ما زالت على الإصلاح الكسول");
  });

  test("🛟 وفشلُ الزرع لا يُفشل الطلبَ الأصليّ", () => {
    assert.ok(/catch/.test(read(SEED)), "خطأُ زرعٍ يُسقط شاشةَ إدارة الفنيين");
  });
});
