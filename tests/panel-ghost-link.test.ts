import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ═════ 👻 وهْمُ اللوحتين — بلاغُ كاسبر 2026-08-26 ليلاً ═════
// «بكلّ مزامنةٍ يظهر كلُّ المشتركين: رقمُ الساس تغيّر — ويعطيني **نفسَ الرقم القديم**».
// 🔬 الجذر: خرائطُ **الرقم** مقيَّدةٌ بلوحة الدورة (`panelWhere`) وخرائطُ **اليوزر** على
// المكتب كلِّه — فمشتركُ اللوحة الأخرى (أو غيرُ الموسوم) يضيع بالرقم ويُلتقَط باليوزر
// بنفس الرقم ⇒ «تغيّرٌ» مُفتعَلٌ (قديم = جديد) لكلّ مشتركٍ في كلّ دورة، وحصْراً في
// المكاتب متعدّدة اللوحات (كاسبر). والقاعدة: **تطابُقُ الرقمَين ينفي الربطَ الجديد**.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const SYNC = () => read("src/lib/subscriptionSync.ts");

describe("👻 تطابقُ الرقمَين ينفي «رقم الساس تغيّر»", () => {
  test("المرحلة ٢ (موضعُ البلاغ): لا فرقَ ربطٍ ولا closeDeadSasRows حين يتساوى الرقمان", () => {
    const src = SYNC();
    assert.match(src, /if \(oldByUser && oldByUser\.sasId === u\.sasId\) \{/,
      "🔴 سقط حارسُ التطابق ⇒ يعود «رقم الساس تغيّر» بنفس الرقم لكلّ مشتركٍ كلَّ مزامنة");
    // موسومٌ للوحةٍ أخرى ⇒ دورتُها تتكفّل به — لا يُعالَج مرّتَين
    assert.match(src, /oldByUser\.sasPanelId != null && panelId != null && oldByUser\.sasPanelId !== panelId\) continue;/,
      "مشتركُ اللوحة الأخرى يُعالَج في دورةِ غير لوحته");
    // والفرقُ الحقيقيُّ (رقمان مختلفان) يبقى مرصوداً كما كان حرفيّاً
    assert.match(src, /\} else if \(oldByUser\) \{\s*\r?\n\s*dupUserSkipped\+\+;/,
      "رصدُ تغيّرِ الرقم الحقيقيّ سقط مع الإصلاح");
  });

  test("والمرحلة ١ بموضعَيها: نفسُ الرقم من لوحةٍ أخرى يُتخطّى ولا يُحسَب مكرَّراً", () => {
    const src = SYNC();
    assert.match(src, /if \(byUser && byUser\.sasId === a\.sasUserId\) \{\s*\r?\n\s*if \(byUser\.sasPanelId != null && panelId != null && byUser\.sasPanelId !== panelId\) continue;/,
      "حلقةُ تفعيلات الأمس بلا حارس التطابق");
    assert.match(src, /byUser\.sasId === a\.sasUserId && byUser\.sasPanelId != null && panelId != null && byUser\.sasPanelId !== panelId\) continue;/,
      "حلقةُ الأحداث بلا حارس التطابق");
    // ولا يُحسَب التطابقُ «يوزراً مكرَّراً» — فالعدّادُ للرقمَين المختلفَين حصراً
    const eq = src.indexOf("if (byUser && byUser.sasId === a.sasUserId) {");
    const dup = src.indexOf("dupUserPhase1++");
    assert.ok(eq > -1 && dup > eq, "عدّادُ التكرار صار يلتقط التطابقَ البريء");
  });

  test("🔒 والخرائطُ تقرأ لوحةَ المشترك — بلاها لا يعمل أيُّ حارس", () => {
    const src = SYNC();
    assert.equal((src.match(/name: true, netUser: true, sasPanelId: true \}/g) ?? []).length >= 2, true,
      "خريطتا المرحلة الثانية بلا عمود اللوحة");
    assert.match(src, /select: \{ id: true, sasId: true, name: true, netUser: true, dateTo: true, sasPanelId: true \}/,
      "خريطةُ المرحلة الأولى بلا عمود اللوحة");
  });
});
