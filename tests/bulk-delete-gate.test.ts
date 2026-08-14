import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BULK_DELETE_GATE } from "../src/lib/bulkDeleteGate";

// ═══ و-٤ · تجميدُ الحذفِ الجماعيِّ الكبير بكلمةِ مرور المالك ═══
//
// 🔴 الحادثةُ المقيسة: ٩ آب ٢٠٢٦ — **٤٣٤ كارتاً** حُذفت بضغطةٍ واحدةٍ من «الكروت
//   الوهميّة»، وكان **٧٤ منها مبيعاً ومقبوضَ الثمن** (٣٥٬٠٠٠ للواحد). ولم يُنبِّه ذلك
//   أحداً، ولم يُكتشَف إلّا بعد أربعةِ أيّامٍ بقائمةِ سيريالاتٍ أرسلها محمد بيده.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PATHS = [
  "src/app/api/recharge-cards/bulk-delete/route.ts",
  "src/app/api/manager/phantom-cards/route.ts",
];

describe("🛡️ و-٤ · بوّابةُ الحذف الجماعيّ", () => {
  test("الحدُّ خمسونَ صفّاً — فلا تُعطَّل أعمالُ اليوم", () => {
    assert.equal(BULK_DELETE_GATE, 50);
  });

  test("🔴 كلا مسارَي الحذف الجماعيِّ مُبوَّبان — ومنهما مسارُ الحادثة", () => {
    for (const rel of PATHS) {
      const src = read(rel);
      assert.ok(src.includes("requireOwnerForBulk("), `مسارٌ بلا بوّابة: ${rel}`);
    }
  });

  test("🔑 والبوّابةُ **قبل** اللقطة والحذف — لا بعد أثرٍ لا يُسترَدّ", () => {
    for (const rel of PATHS) {
      const src = read(rel);
      const gate = src.indexOf("requireOwnerForBulk(");
      const cap = src.indexOf("captureCardsBeforeDelete(");
      const del = src.search(/prisma\.rechargeCard\.delete(Many)?\s*\(/);
      assert.ok(gate > 0 && gate < cap, `البوّابةُ بعد اللقطة في ${rel}`);
      assert.ok(gate < del, `البوّابةُ بعد الحذف في ${rel}`);
    }
  });

  test("والعددُ يُقاس بشرطِ الحذف نفسِه لا بما حدّده المتصفّح", () => {
    const src = read(PATHS[0]);
    assert.ok(/prisma\.rechargeCard\.count\(\{ where \}\)/.test(src),
      "العددُ من العميل — فيُمكن تجاوزُ البوّابة بإرسالِ رقمٍ صغير");
  });

  test("🔒 والإذنُ بكلمةِ مرور **المالك** لا بصلاحيّةِ الحذف", () => {
    const g = read("src/lib/bulkDeleteGate.ts");
    assert.ok(g.includes("confirmOwnerPassword("), "لا تحقّقَ من كلمة مرور المالك");
    // و`confirmOwnerPassword` يشترط isOwner — لا يكفي أن يكون مديراً
    assert.ok(read("src/lib/guard.ts").includes("owner?.isOwner"), "المالكُ غيرُ مشروطٍ في المُساعِد");
  });

  test("والمنعُ والإذنُ كلاهما يُسجَّلان — فبوّابةٌ بلا أثرٍ لا تُحاسِب", () => {
    const g = read("src/lib/bulkDeleteGate.ts");
    assert.ok(g.includes("BULK_DELETE_BLOCKED"), "المنعُ يمرّ بلا أثر");
    assert.ok(g.includes("BULK_DELETE_OWNER_OK"), "الإذنُ يمرّ بلا أثر");
  });

  test("🖥️ والواجهتان تطلبان الكلمةَ وتُعيدان المحاولةَ مرّةً واحدة", () => {
    for (const rel of ["src/app/(app)/cards/page.tsx", "src/app/(app)/manager-accounts/page.tsx"]) {
      const src = read(rel);
      assert.ok(src.includes("needOwnerPassword"), `واجهةٌ لا تفهم البوّابة: ${rel}`);
      assert.ok(/كلمةُ مرور المالك/.test(src), `واجهةٌ لا تطلب الكلمة: ${rel}`);
    }
  });

  test("ولا تُخزَّن كلمةُ المرور في حالةٍ أو تخزينٍ محلّيّ", () => {
    for (const rel of ["src/app/(app)/cards/page.tsx", "src/app/(app)/manager-accounts/page.tsx"]) {
      const src = read(rel);
      assert.equal(/localStorage[^\n]*ownerPassword|useState[^\n]*ownerPassword/.test(src), false,
        `كلمةُ المالك مُخزَّنةٌ في ${rel}`);
    }
  });
});

describe("🛡️ و-٣ · حذفُ مشتركٍ عليه دَينٌ أو تفعيلٌ سارٍ", () => {
  const R = "src/app/api/subscribers/bulk-delete/route.ts";

  test("🔴 البوّابةُ **قبل** الحذف الفيزيائيّ — فهو يمحو الوصولاتِ وحركاتِ الصندوق", () => {
    const src = read(R);
    const gate = src.indexOf("requireOwnerForSubscriberPurge(");
    const purge = src.indexOf("purgeSubscribers(");
    assert.ok(gate > 0, "لا بوّابةَ على حذف المشتركين");
    assert.ok(gate < purge, "البوّابةُ بعد الحذف — والحذفُ لا يُسترَدّ");
  });

  test("🔑 والقياسُ بالضرر لا بالعدد: دَينٌ أو تفعيلٌ سارٍ", () => {
    const g = read("src/lib/bulkDeleteGate.ts");
    const blk = g.slice(g.indexOf("requireOwnerForSubscriberPurge"));
    assert.ok(/carry: \{ gt: 0 \}/.test(blk), "الدَّينُ غيرُ مفحوص");
    assert.ok(/dateTo: \{ gt: new Date\(\) \}/.test(blk), "التفعيلُ الساري غيرُ مفحوص");
    // ولا حدَّ عددٍ هنا: واحدٌ عليه دَينٌ يكفي
    assert.equal(/BULK_DELETE_GATE/.test(blk), false, "قِيس بالعدد فمرّ مشتركٌ عليه دَين");
  });

  test("والرسالةُ تُسمّي المشتركين ومبلغَ الدَّين — فالقرارُ يُبنى على معلومة", () => {
    const g = read("src/lib/bulkDeleteGate.ts");
    const blk = g.slice(g.indexOf("requireOwnerForSubscriberPurge"));
    assert.ok(/sample/.test(blk) && /debt\.toLocaleString/.test(blk), "الرسالةُ بلا أسماءَ ولا مبلغ");
    assert.ok(/SUB_PURGE_BLOCKED/.test(blk) && /SUB_PURGE_OWNER_OK/.test(blk), "بلا أثرٍ في التدقيق");
  });

  test("🖥️ وواجهةُ المشتركين تطلب الكلمةَ ولا تُخزّنها", () => {
    const src = read("src/components/SubscribersBoard.tsx");
    assert.ok(src.includes("needOwnerPassword"), "الواجهةُ لا تفهم البوّابة");
    assert.ok(src.includes("sendPurge("), "النداءُ لم يُوحَّد فيبقى مسارٌ بلا بوّابة");
    assert.equal(/useState[^\n]*ownerPassword|localStorage[^\n]*ownerPassword/.test(src), false, "الكلمةُ مُخزَّنة");
  });
});
