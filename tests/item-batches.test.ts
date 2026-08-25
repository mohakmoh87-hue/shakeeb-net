import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { batchTag } from "../src/app/api/_lib/itemBatchLog";

// ═════ 📦 سجلُّ دفعات المخزن — سؤالُ محمد 2026-08-25 ═════
//
// «سعرُ الشراء قد يختلف لنفس المادة في وقتٍ لاحق — كيف سيميّز ذلك؟ وكيف سأعرف سعرَ شراء
//  المادة في كلّ مرّةٍ أزيد العدد؟» ثمّ حسم: **«يجب إدخالُ سعر المادة عند زيادة عددها»**.
//
// 🔴 وقبلها: المادةُ صفٌّ واحدٌ بكلفةٍ واحدة — المستخدمُ يزيد الكميّةَ فتبقى كلفةُ أوّل
//   دفعةٍ للأبد، والمديرُ إن كتب كلفةً جديدةً مُحيت القديمةُ بلا أثر، وسجلُّ التدقيق
//   يحفظ الكميّةَ ولا يذكر السعرَ أبداً.
// 🎯 وقرارُه: **سجلٌّ للقراءة وحدَه** — لا متوسّطٌ ولا FIFO، فلا يُمَسّ ربحٌ ولا مسارُ بيع.

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PUT = () => read("src/app/api/items/[id]/route.ts");
const POST = () => read("src/app/api/items/route.ts");
const API = () => read("src/app/api/items/[id]/batches/route.ts");
const LIB = () => read("src/app/api/_lib/itemBatchLog.ts");

describe("📦 وسمُ الدفعة يُكتب ويُقرأ بلا لبس", () => {
  test("الوسمُ يحمل الكميّتَين والسعر — ويُقرأ بالتعبير نفسِه", () => {
    const tag = batchTag(20, 50, 7000);
    assert.match(tag, /⟦q:20→50\|buy:7000⟧/);
    const re = /⟦q:(-?\d+(?:\.\d+)?)→(-?\d+(?:\.\d+)?)(?:\|buy:(-?\d+(?:\.\d+)?))?⟧/;
    const m = re.exec(tag);
    assert.deepEqual([m?.[1], m?.[2], m?.[3]], ["20", "50", "7000"]);
  });

  test("🔒 ولا يُلفَّق سعرٌ حيث لا سعر: الإنقاصُ والصفرُ والفارغ بلا `buy`", () => {
    // إنقاصٌ ليس شراءً، وسعرُ صفرٍ ليس سعراً — والسجلُّ الكاذبُ أسوأُ من الناقص
    for (const p of [null, undefined, 0, -5]) {
      assert.equal(/buy:/.test(batchTag(50, 20, p as number | null)), false, `سعرٌ لُفّق من ${p}`);
    }
    assert.match(batchTag(50, 20, null), /⟦q:50→20⟧/, "الكميّتان تُفقدان عند الإنقاص");
  });

  test("🔁 والصفوفُ القديمةُ تُقرأ من نصّها العربيّ — بسعرٍ فارغٍ لا مخترَع", () => {
    const lib = LIB();
    assert.match(lib, /const alt = m \? null : \/من /, "ارتدادُ قراءة الصفوف القديمة سقط");
    assert.match(lib, /const before = Number\(m\?\.\[1\] \?\? alt\?\.\[1\] \?\? 0\);/, "الكميّاتُ لا تُقرأ من الصفوف القديمة");
    assert.match(lib, /buyPrice: buy != null && Number\.isFinite\(buy\) \? buy : null/,
      "سعرُ الصفوف القديمة يُملأ بقيمةٍ بدل `null` — سجلٌّ يكذب");
  });
});

describe("💰 «يجب إدخال سعر المادة عند زيادة عددها» — حكمٌ خادميّ", () => {
  test("الزيادةُ بلا سعرٍ تُرفَض 400 — للمستخدم وللمدير معاً", () => {
    const src = PUT();
    assert.match(src, /const requireBatchPrice = \(before: number, after: number, price: number \| null \| undefined\)/,
      "حارسُ سعر الدفعة غائب");
    assert.match(src, /if \(after <= before\) return null;/, "الحارسُ يُطالب بسعرٍ عند الإنقاص أيضاً");
    assert.match(src, /لا تُقبل زيادةُ الكمية بلا سعر/, "رسالةُ الرفض تغيّرت");
    // مسارُ المستخدم العاديّ
    assert.match(src, /const bad = requireBatchPrice\(current, q\.data\.count, q\.data\.batchBuyPrice\);\s*\r?\n\s*if \(bad\) return bad;/,
      "مسارُ المستخدم العاديّ يمرّ بلا حارس");
    // مسارُ المدير — سعرُه الصريحُ أو الكلفةُ التي كتبها
    assert.match(src, /const adminBatchPrice = batchBuyPrice \?\? parsed\.data\.priceDinar \?\? existing\.priceDinar;/,
      "سعرُ دفعة المدير لم يعد يُشتقّ من نموذجه");
    assert.match(src, /const bad = requireBatchPrice\(existing\.count \?\? 0, parsed\.data\.count, adminBatchPrice\);/,
      "مسارُ المدير يمرّ بلا حارس");
  });

  test("🔒 وكلفةُ المادة **لا تُمَسّ** بزيادة الكميّة — قرارُ محمد", () => {
    const src = PUT();
    // مسارُ المستخدم يكتب الكميّةَ وحدَها
    assert.match(src, /data: \{ count: q\.data\.count \}/, "مسارُ المستخدم صار يكتب حقولاً أخرى — قد يمسّ الكلفة");
    // و`batchBuyPrice` يُنزَع من بيانات المدير فلا يُكتب عموداً في الجدول
    assert.match(src, /const \{ batchBuyPrice, \.\.\.itemData \} = parsed\.data;/, "سعرُ الدفعة قد يُكتب حقلاً في المادة");
    assert.match(src, /data: itemData,/, "تعديلُ المدير يكتب `parsed.data` خاماً — فيه سعرُ الدفعة");
  });

  test("📥 والدفعةُ الافتتاحيّةُ تُسجَّل عند الإنشاء — فلا يبدأ السجلُّ من الثانية", () => {
    const src = POST();
    assert.match(src, /if \(openCount > 0 && !\(openPrice > 0\)\)/, "إنشاءٌ بكميّةٍ بلا سعرٍ يمرّ");
    assert.match(src, /details: `دفعة افتتاحية/, "الدفعةُ الافتتاحيّة لا تُسجَّل");
    assert.match(src, /batchTag\(0, openCount, openPrice\)/, "قيدُ الافتتاح بلا وسمٍ آليّ ⇒ لا يظهر في السجلّ");
  });
});

describe("🔒 عزلُ سجلّ الدفعات", () => {
  test("المكتبُ يُتحقَّق منه، والكلفةُ للمدير حصراً", () => {
    const api = API();
    assert.match(api, /guard\("inventory\.manage"\)/, "المسارُ بلا صلاحيّة");
    assert.match(api, /if \(!g\.session\?\.isAdmin\)/, "🔴 بابٌ خلفيٌّ يكشف أسعارَ الشراء لغير المدير");
    assert.match(api, /!\(await ownsTower\(g\.session, item\.towerId\)\)/, "🔴 يُقرأ سجلُّ مادّةِ وكيلٍ آخر");
    assert.match(api, /status: 404/, "مادّةُ وكيلٍ آخرَ تُميَّز عن غير الموجودة");
    // 🔒 قراءةٌ محضة: لا كتابةَ في مسار السجلّ إطلاقاً
    assert.equal(/prisma\.\w+\.(create|update|updateMany|delete|deleteMany)/.test(api), false,
      "مسارُ السجلّ يكتب — وهو للقراءة وحدَها");
  });

  test("🔒 وزرُّ السجلّ في الواجهة للمدير أيضاً — لا يُكتفى بالخادم", () => {
    const page = read("src/app/(app)/inventory/page.tsx");
    assert.match(page, /\{isAdmin && \(\s*\r?\n\s*<button\s*\r?\n\s*onClick=\{\(\) => setBatchItem\(r\)\}/,
      "زرُّ الدفعات يظهر لغير المدير فيصطدم بـ403");
    assert.match(page, /name: "batchBuyPrice", label: "سعر شراء هذه الدفعة \(إلزامي\)", type: "number", required: true/,
      "حقلُ سعر الدفعة ليس إلزاميّاً في نموذج الزيادة");
  });
});
