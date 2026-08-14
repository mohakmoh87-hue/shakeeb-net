import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ أ-٥ · الموضع ١: تحويلُ مبلغٍ بين النقديّ والماستر في التقرير اليوميّ ═══════
//
// «بالضغط على المجموع (الماستر أو الكلّي) تظهر التفاصيل، ويظهر أسفلها "تحويل"» — والبنيةُ
// صفّان مزدوجان بمؤشّرَين متبادلَين يُحذفان معاً دفعةً واحدة.
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const API = "src/app/api/money/transfer/route.ts";
const VOID = "src/app/api/money/[id]/void/route.ts";
const MODAL = "src/components/TxDrillModal.tsx";

describe("أ-٥/١ · تحويلُ مبلغٍ نقدي↔ماستر", () => {
  test("🔑 صفّان مزدوجان: جهةُ الماستر بنوع «master» المعرَّف — لا نوعٌ مخترَع", () => {
    const src = read(API);
    // وجهةُ الماستر تحمل النوعَ الذي تعرفه moneyKinds — وإلّا اختفى المبلغ من الشاشات
    assert.ok(/sourceType: "master"/.test(src), "جهةُ الماستر ليست بنوع master");
    assert.ok(/sourceType: "transfer"/.test(src), "جهةُ النقد بلا نوعٍ مميِّزٍ للزوج");
    assert.ok(!/MASTER_SOURCE_TYPES\s*=/.test(src), "يُعيد تعريفَ قائمة الماستر يدويّاً");
  });

  test("🔒 الزوجُ في معاملةٍ واحدة وبمؤشّرَين متبادلَين", () => {
    const src = read(API);
    assert.ok(/\$transaction/.test(src), "الصفّان بلا معاملة — انقطاعٌ بينهما يترك نصفَ تحويل");
    assert.ok(/sourceId: cash\.id/.test(src), "صفُّ الماستر لا يشير إلى شقّه النقديّ");
    assert.ok(/data: \{ sourceId: master\.id \}/.test(src), "صفُّ النقد لا يشير إلى شقّه الماستر");
  });

  test("🔒 والعزل: المكتبُ المطلوب من مكاتب الوكيل حصراً، ولا قيدَ بلا مكتب", () => {
    const src = read(API);
    assert.ok(src.includes("agentTowerIds"), "بلا نطاق مكاتب الوكيل");
    assert.ok(/لا يتبع حسابك/.test(src), "مكتبُ وكيلٍ آخرَ لا يُرفض");
    assert.ok(/اختر مكتباً/.test(src), "قيدٌ بلا مكتبٍ يمرّ فيختفي من التقارير");
  });

  test("ب-٠٠ · لا كسورَ في المبلغ", () => {
    assert.ok(/\.int\(/.test(read(API)), "مبلغٌ كسريٌّ يمرّ إلى الصندوق");
  });

  test("🗑 والحذفُ زوجاً: مسارُ الإبطال يتحقّق من المؤشّرَين المتبادلَين ويحذفهما معاً", () => {
    const src = read(VOID);
    assert.ok(/other\.sourceId === tx\.id/.test(src), "بلا تحقّقٍ من تبادل المؤشّرَين — يلتبس بماستر وصلٍ صادف رقمُه");
    assert.ok(/id: \{ in: \[tx\.id, other\.id\] \}/.test(src), "لا يحذف الشقَّين معاً");
    // والفرعُ قبل حارس «الماستر المرتبط بوصل» — وإلّا اعترضه برسالةٍ عن وصلٍ لا وجودَ له
    assert.ok(src.indexOf("زوجُ تحويلٍ") < src.indexOf("مرتبطة بوصل"), "فرعُ الزوج بعد حارس الوصل — فلا يصل إليه أبداً");
  });

  test("🖥️ النموذجُ أسفل تفصيلَي «المجموع» و«الماستر» لليوم الحاليّ فقط", () => {
    const src = read(MODAL);
    assert.ok(/allowTransfer && !day/.test(src), "يظهر في نوافذ الأيّام الماضية أيضاً");
    assert.ok(/kind === "total" \|\| kind === "master"/.test(src), "لا يقتصر على المجموع والماستر");
    assert.ok(/window\.confirm/.test(src), "تحويلٌ بلا تأكيد — وهو يمسّ توزيعَ المال");
    assert.ok(src.includes('can("finance.manage")'), "بلا فحص صلاحيّة");
    // والبطاقةُ تمرّر الإذنَ — ونوافذُ حسابات المدير لا تمرّره فلا يظهر فيها
    assert.ok(/allowTransfer/.test(read("src/components/DailyReportCard.tsx")), "بطاقةُ التقرير لا تُفعّل النموذج");
  });
});
