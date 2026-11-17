import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 📷 صورةُ إنجاز البطاقة (صيانة/تحويل) — طلبُ محمد 2026-11-17 ═════
// الميزةُ أُلغيت 2026-07-29 لحجم الصور (١٧م من أصل ٣٧)، وأُعيدت بإذنِ مالكٍ لكلّ وكيل.
// وهذه الحرّاسُ تحمي ما يسقط صامتاً: صلاحيّةُ حاسبة المكتب، وحدُّ النصف ميغا، والنسخةُ اليوميّة.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("إذنُ صورة الإنجاز معزولٌ بالوكيل ومحروسٌ خادميّاً", () => {
  const route = code("src/app/api/field/complete/route.ts");

  test("العلَمُ يُقرأ من وكيل الفاعل لا من العميل", () => {
    assert.ok(/prisma\.agent\.findUnique\(\{ where: \{ id: actor\.agentId \}, select: \{ cardPhotoAllowed: true \} \}\)/.test(route),
      "🔴 الإذنُ لا يُقرأ من صفّ وكيل الفاعل — عَلَمٌ من العميل يُفتح به الباب");
    assert.ok(!/photoOn\s*=\s*(true|!!parsed)/.test(route), "🔴 الإذنُ يُؤخذ من الطلب لا من القاعدة");
  });

  test("الصورةُ واجبةٌ على الفنيّ وحدَه في فئتَي الصيانة والتحويل", () => {
    assert.ok(/effKind === "صيانة" \|\| effKind === "تحويل"/.test(route), "🔴 الفئتان لم تبقيا صيانةً وتحويلاً");
    assert.ok(/!isDelivery &&/.test(route), "🔴 بطاقةُ توصيلٍ باسم صيانةٍ قد تُطالَب بصورة");
    assert.ok(/photoOn && actor\.isTech && !photoData[\s\S]{0,160}status: 400/.test(route),
      "🔴 لا رفضَ خادميّاً لإنجاز الفنيّ بلا صورة — الواجهةُ وحدَها ليست حارساً");
  });

  test("حدُّ ٥٠٠ كيلوبايت مفروضٌ على ما يُخزَّن فعلاً", () => {
    assert.ok(/const PHOTO_MAX_BYTES = 500 \* 1024;/.test(route), "🔴 حدُّ الحجم تغيّر عن ٥٠٠ك");
    assert.ok(/bytes > PHOTO_MAX_BYTES[\s\S]{0,140}status: 400/.test(route), "🔴 لا رفضَ لما تجاوز الحدّ");
    assert.ok(route.includes("data:image\\/(jpeg|png|webp);base64"), "🔴 أيُّ نصٍّ يُقبل مكان الصورة");
  });

  test("بلا إذنٍ لا يُخزَّن شيءٌ مهما أُرسل", () => {
    assert.ok(/const photoData = photoOn \? photo\?\.trim\(\) \|\| null : null;/.test(route),
      "🔴 الصورةُ قد تُخزَّن لوكيلٍ بلا إذن");
    assert.ok(/if \(photoData\) \{\s*await tx\.cardPhoto\.upsert/.test(route),
      "🔴 الصورةُ لا تُحفظ داخل معاملة الإنجاز — بطاقةٌ منجزةٌ بلا دليلها");
  });
});

describe("حاسبةُ المكتب تملك صلاحيّةَ الكتابة (وإلّا سقط الإنجازُ كلُّه)", () => {
  const grants = read("prisma/rls/02-grants.sql");

  test("card_photos: إدراجٌ وتحديثٌ وحذف + تسلسلُها", () => {
    assert.ok(/GRANT SELECT, INSERT, UPDATE, DELETE ON card_photos TO agent_worker;/.test(grants),
      "🔴 الجدولُ للقراءة فقط — إدراجُ الصورة داخل معاملة الإنجاز يُسقط الفاتورةَ والمخزنَ معها");
    assert.ok(/GRANT USAGE, SELECT ON SEQUENCE card_photos_id_seq TO agent_worker;/.test(grants),
      "🔴 بلا تسلسلٍ ممنوحٍ يفشل الإدراج ولو مُنح الجدول");
  });

  test("العمودُ الجديد على agents ممنوحٌ بالاسم (حادثةُ odooSlaSendAllowed)", () => {
    const block = /GRANT SELECT \(([\s\S]*?)\)\s*\n\s*ON agents TO agent_worker;/.exec(grants);
    assert.ok(block, "لم يُعثر على منحِ أعمدة agents");
    assert.ok(block![1].includes('"cardPhotoAllowed"'),
      "🔴 الإذنُ يُقرأ على حاسبة المكتب وعمودُه غيرُ ممنوح ⇒ تموت الميزةُ بصمتٍ كما مات إرسالُ أودو شهراً");
  });

  test("سياسةُ RLS تسمح بالكتابة معزولةً بالوكيل", () => {
    const pol = read("prisma/rls/03-policies.sql");
    assert.ok(/CREATE POLICY rls_card_photos ON card_photos TO agent_worker[\s\S]*?WITH CHECK/.test(pol),
      "🔴 لا WITH CHECK ⇒ الإدراجُ يُرفَض وإن مُنحت الصلاحيّة");
  });
});

describe("الصورُ لا تُسقط النسخَ الاحتياطيّة", () => {
  const backup = code("src/lib/backup.ts");

  test("مستثناةٌ من نسخة الوكيل ومن نسخة النظام الكاملة", () => {
    assert.ok(/const EXCLUDE = new Set\(\[[\s\S]*?"card_photos",[\s\S]*?\]\);/.test(backup),
      "🔴 الصورُ عادت إلى نسخة الوكيل — مرفقُ البريد يتجاوز ٢٤ ميغا فتتوقّف النسخةُ كلُّها");
    assert.ok(/const FULL_EXCLUDE = new Set\(\["_prisma_migrations", "card_photos"\]\);/.test(backup),
      "🔴 الصورُ عادت إلى النسخة الكاملة — شبكةُ الأمان الوحيدة تُسقطها الأحجام");
    assert.ok(!/await emit\("card_photos"/.test(backup), "🔴 بثُّ الصور ما زال قائماً في نسخة الوكيل");
  });
});
