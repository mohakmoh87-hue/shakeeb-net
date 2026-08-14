import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═══════ ب-٢ · الإرسالُ الجماعيُّ لا يُكمل أبداً — صار طابوراً في القاعدة يُستأنف ═══════
// بثُّ الشدن مات عند ٤١٦/٢٤٤٧: الحلقةُ كانت مفصولةً في ذاكرة الحاوية وأيُّ نشرةٍ تقتلها،
// والصفوفُ كانت تُكتب **بعد** كلّ محاولةٍ فلا أثرَ للبقيّة.
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const Q = "src/lib/broadcastQueue.ts";
const ROUTE = "src/app/api/messages/route.ts";

describe("ب-٢ · طابور البثّ الجماعيّ", () => {
  test("🔑 المستلمون يُكتبون صفوفاً PENDING **قبل** أيّ إرسال — فالمتبقّي محفوظٌ مهما حدث", () => {
    const src = read(ROUTE);
    assert.ok(/message\.createMany\(\{ data: rows \}\)/.test(src), "لا اصطفافَ مسبقاً — عادت حلقةُ الذاكرة");
    assert.ok(/kickBroadcastDrainer/.test(src), "المسارُ لا يركل الساحب");
  });

  test("🔒 الحَجزُ ذرّيٌّ بعبارةٍ واحدة (درسُ الشدن: لا استطلاعَ بلا حَجز)", () => {
    const src = read(Q);
    assert.ok(/FOR UPDATE SKIP LOCKED/.test(src), "حاويتان متراكبتان لحظةَ نشرٍ سترسلان الصفَّ مرّتَين");
    assert.ok(/UPDATE messages SET error = \$\{CLAIM_MARK\}/.test(src), "الحَجزُ ليس بعلامةٍ تُفحَص");
  });

  test("📴 حاسبةُ المكتب مطفأة ⇒ الصفُّ يبقى منتظراً لا فاشلاً — البثُّ يُستأنف حين تعود", () => {
    const src = read(Q);
    assert.ok(/غير مشغّلة\|غير متصل/.test(src), "غيابُ الناقل يُختَم فشلاً — فتضيع الرسالة");
    assert.ok(/releaseClaim/.test(src), "الحَجزُ لا يُفَكّ عند غياب الناقل");
    // ولا خلودَ: المنتظرُ فوق ٤٨ ساعةً يُختَم بسببٍ مقروء
    assert.ok(/EXPIRE_H/.test(src), "صفٌّ منتظرٌ يخلد للأبد");
  });

  test("🔁 الاستئنافُ عند إقلاع الموقع — وعلى الموقع حصراً لا حواسيب المكاتب", () => {
    const src = read("src/instrumentation.ts");
    assert.ok(/RUN_WORKER !== "1"/.test(src), "الساحبُ يعمل على حواسيب المكاتب أيضاً — تعدُّدُ سحّابين بلا داعٍ");
    assert.ok(/kickBroadcastDrainer\("إقلاع الموقع"\)/.test(src), "لا استئنافَ بعد النشرة — عينُ موتِ بثّ الشدن");
  });

  test("⏱️ فاصلُ مكافحة الحظر باقٍ بين رسالةٍ وأخرى", () => {
    assert.ok(/GAP_MS = 10_000/.test(read(Q)), "سقط فاصلُ الـ١٠ ثوانٍ — خطرُ حظر الرقم");
  });

  test("👤 الفرديُّ يبقى فوريّاً — المستخدمُ ينتظر نتيجتَه أمامه", () => {
    assert.ok(/target !== "one" && recipients\.length > 1/.test(read(ROUTE)), "الفرديُّ صار يصطفّ — فقدَ المستخدمُ نتيجتَه الفوريّة");
  });
});
