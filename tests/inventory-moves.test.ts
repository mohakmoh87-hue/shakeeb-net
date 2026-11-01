import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 🔁🧰 سجلُّ الترحيلات والذمم — الحرّاسُ البنيويّون (طلبُ محمد 2026-11-01) ═════
//
// الترحيلُ كان يُنقص مخزناً ويزيد آخرَ بلا سطرٍ واحد، والذمّةُ تحفظ الرصيدَ لا الحركة.
// فالحرّاسُ على القاعدة: **كلُّ مسارٍ يُحرّك مخزناً أو ذمّةً يكتب قيدَه**، والقراءةُ
// معزولةٌ بمكاتب الوكيل، والكلفةُ للمدير، ولا حركةَ تُعَدّ مرّتَين.

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const LOG = read("src/app/api/_lib/inventoryMoveLog.ts");
const ROUTE = read("src/app/api/inventory/moves/route.ts");
const TRANSFER = read("src/app/api/inventory/transfer/route.ts");
const CUSTODY = read("src/app/api/inventory/custody/route.ts");
const PAGE = read("src/app/(app)/inventory/page.tsx");
const MODAL = read("src/components/InventoryMovesModal.tsx");

describe("🔁🧰 سجلُّ الترحيلات والذمم", () => {
  test("كلُّ مسارٍ يُحرّك مخزناً أو ذمّةً يكتب قيدَه", () => {
    const post = (s: string) => s.slice(s.indexOf("export async function POST"));
    assert.match(post(TRANSFER), /INV_TRANSFER/, "الترحيلُ بلا قيد — حركةٌ بلا أثر");
    assert.match(post(CUSTODY), /CUSTODY_GIVE/, "التسليمُ بلا قيد");
    assert.match(post(CUSTODY), /CUSTODY_RETURN/, "الاستلامُ بلا قيد");
    for (const [name, src] of [["الترحيل", TRANSFER], ["الذمم", CUSTODY]] as const) {
      assert.match(src, /moveTag\(\{/, `${name}: القيدُ بلا وسمٍ آليٍّ ⇒ لا يُقرأ بلا تخمين`);
    }
  });

  test("🔑 القيدُ بإدراجٍ خامٍّ بلا RETURNING — دورُ حاسبة المكتب «إدراجٌ فقط»", () => {
    for (const [name, src] of [["الترحيل", TRANSFER], ["الذمم", CUSTODY]] as const) {
      assert.match(src, /\$executeRaw`INSERT INTO audit_logs/, `${name}: قيدٌ بـcreate يسقط على حاسبة المكتب`);
      const post = src.slice(src.indexOf("export async function POST"));
      assert.doesNotMatch(post, /auditLog\.create\(/, `${name}: create بدل الإدراج الخامّ`);
    }
  });

  test("الوسمُ يحمل المعرّفاتَ لا الأسماء — فالفلترةُ بمعرّفٍ لا بنصٍّ يملكه المستخدم", () => {
    const tag = LOG.slice(LOG.indexOf("export function moveTag"), LOG.indexOf("export function parseMoveTag"));
    for (const k of ["it:", "q:", "from:", "to:", "tech:"]) {
      assert.ok(tag.includes(k), `الوسمُ بلا ${k}`);
    }
  });

  test("🔒 القراءةُ خلف صلاحيّة المخزن ومعزولةٌ بمكاتب الوكيل", () => {
    assert.match(ROUTE, /guard\("inventory\.manage"\)/, "القراءةُ بلا حارس");
    assert.match(ROUTE, /agentTowerIds\(session\)/, "النطاقُ ليس مكاتبَ الوكيل");
    assert.match(ROUTE, /!session\.isAdmin && session\.towerId != null/, "مستخدمُ المكتب يرى غيرَ مكتبه");
    assert.match(ROUTE, /offices\.includes\(reqOffice\)/, "فلترُ المكتب يُقبل بلا تحقّقٍ من النطاق");
    assert.match(LOG, /if \(!offices\.length\) return \{ rows: \[\], truncated: false \}/, "بلا مكاتبَ تُقرأ حركاتُ الجميع");
  });

  test("كلُّ صفٍّ يُسقَط إن لم يكن مكتبُه في النطاق (فشلٌ مغلق)", () => {
    assert.match(LOG, /const inScope = \(\.\.\.ids/, "لا فاحصَ نطاقٍ للصفوف");
    for (const re of [/if \(!inScope\(t\.fromTower, t\.toTower/, /if \(!inScope\(fromT, toT\)\) continue/, /if \(!it \|\| !inScope\(it\.towerId\)\) continue/]) {
      assert.match(LOG, re, "صفٌّ يمرّ بلا فحصِ نطاق");
    }
    assert.match(LOG, /towerId: \{ in: offices \}/, "استعلامُ الدفعات/البيع بلا حصرِ مكاتب");
    assert.match(LOG, /agentId: qy\.agentId/, "استعلامٌ بلا عزلِ وكيل");
  });

  test("💰 الكلفةُ للمدير وحدَه — كخانة «الكلفة» في المخزن", () => {
    assert.match(ROUTE, /showCost: !!session\?\.isAdmin/, "الكلفةُ تُعطى لغير المدير");
    assert.match(LOG, /qy\.showCost \? /, "الكلفةُ تُكتب بلا شرط");
  });

  test("⚖️ لا عدَّ مزدوجاً: مبيعُ البطاقة صرفُ ذمّةٍ أو بيعٌ — لا الاثنان", () => {
    assert.match(LOG, /const kind: MoveKind = isCard \? "CARD_USE" : "SELL"/, "صفُّ البيع قد يُعَدّ بيعاً وصرفاً معاً");
    assert.match(LOG, /covered\.has\(l\.id\)/, "أسطرُ الفواتير القديمة تُضاف فوق الاستهلاك ⇒ عدٌّ مزدوج");
  });

  test("القراءةُ لا تكتب شيئاً — سجلٌّ لا مُعدِّل", () => {
    for (const [name, src] of [["الوحدة", LOG], ["المسار", ROUTE]] as const) {
      assert.doesNotMatch(src, /\.(create|update|updateMany|delete|deleteMany|createMany)\(/, `${name}: كتابةٌ في مسار قراءة`);
      assert.doesNotMatch(src, /\$executeRaw/, `${name}: تنفيذٌ خامٌّ في مسار قراءة`);
    }
  });

  test("حدودُ اليوم بتوقيت بغداد لا بتوقيت الخادم", () => {
    assert.match(ROUTE, /\+03:00/, "يومُ المستخدم يُقرأ بـUTC ⇒ ثلاثُ ساعاتٍ تهاجر لليوم السابق");
  });

  test("🧰 الذمّةُ القائمةُ رصيدٌ لا حركة: تُطلَب صراحةً ولا يحكمها التاريخ", () => {
    assert.match(LOG, /k === "HELD" \? !!qy\.kinds\?\.includes\("HELD"\)/, "الرصيدُ يظهر في «كلّ الحركات» كأنّه حركةٌ بتاريخ آخرِ تغييره");
    const held = LOG.slice(LOG.indexOf('want("HELD")'), LOG.indexOf("]);", LOG.indexOf('want("HELD")')));
    assert.doesNotMatch(held, /range\(/, "مدى التاريخ يُطبَّق على رصيدٍ حاليٍّ ⇒ تبويبٌ فارغ");
    assert.match(held, /qty: \{ gt: 0 \}/, "ذمّةٌ صفريّةٌ تُعرَض");
    assert.match(held, /isDeleted: false/, "ذمّةٌ مشطوبةٌ تُعرَض");
  });

  test("🔒 مكتبُ الذمّة قد يكون فارغاً — يُسنَد من المادّة ولا يمرّ بلا نطاق", () => {
    assert.match(LOG, /\{ towerId: \{ in: offices \} \}, \{ towerId: null \}/, "ذممُ الصفوف القديمة (بلا مكتب) تسقط من العرض");
    assert.match(LOG, /const office = h\.towerId \?\? it\?\.towerId \?\? null;\s*\n\s*if \(!inScope\(office\)\) continue;/, "صفُّ ذمّةٍ يمرّ بلا فحصِ نطاق");
  });

  test("الزرُّ في المخزن والنافذةُ تميّز المُسجَّل من المشتَقّ", () => {
    assert.match(PAGE, /الترحيلات والذمم/, "لا زرَّ في صفحة المخزن");
    assert.match(PAGE, /InventoryMovesModal/, "الزرُّ لا يفتح النافذة");
    assert.match(MODAL, /مُسجَّل/, "لا تمييزَ للقيد عن الاستنتاج");
    assert.match(MODAL, /مشتَقّ/, "لا تمييزَ للاستنتاج عن القيد");
    for (const f of ["from", "to", "officeId", "techId", "q", "minPrice"]) {
      assert.ok(MODAL.includes(`sp.set("${f}"`), `البحثُ بلا ${f}`);
    }
    for (const t of ["الترحيلات", "الذمم", "التسليم والاستلام", "كلُّ الحركات"]) {
      assert.ok(MODAL.includes(t), `التبويبُ «${t}» غائب`);
    }
    assert.match(MODAL, /disabled=\{isHeld\}/, "خانتا التاريخ مفتوحتان في تبويب الأرصدة ⇒ بحثٌ لا يُجدي");
  });
});
