import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// ═════ 🩺 حادثة صميم 2026-08-28 — تذكيرُ الانتهاء ينجو من موت عميل الواتساب ═════
//
// المقيس بالثواني: أرسل الأولى 15:50:41، مات العميلُ ~٧ دقائق، فاحترقت ٦١ رسالةً
// «غير متصل» في دقيقةٍ واحدة — **ونجاحُ اليتيمة ختم اليومَ** فلا إعادةَ حتى الغد.
// (والعميلُ يعود وحدَه: الشارةُ خضراءُ بعدها — اعتلالُ حاسبةِ صميم المزمن.)
// الإصلاحُ الثلاثيّ: إنعاشٌ داخل الدفعة · فكُّ ختمِ الفشل الغالب · دورةُ قضاءٍ نفسَ اليوم.

const ROOT = process.cwd();
const SCHED = () => fs.readFileSync(path.join(ROOT, "src/lib/scheduler.ts"), "utf8");
const WA = () => fs.readFileSync(path.join(ROOT, "src/lib/whatsapp.ts"), "utf8");

describe("🩺 تذكيرُ الانتهاء ينجو من موت عميل الواتساب (2026-08-28)", () => {
  test("١ · مِجسّا الحالة في whatsapp.ts — والرسالةُ نصٌّ واحدٌ لا نسختان تتباعدان", () => {
    const wa = WA();
    assert.ok(wa.includes("export const isWaDown"), "مِجسُّ «العميل ميّت» ضاع — الدفعاتُ عمياء عن سبب الفشل");
    assert.ok(wa.includes("export function waReadyLocal"), "مِجسُّ الجاهزيّة المحلّيّة ضاع — لا ترقّبَ للإنعاش");
    assert.ok(wa.includes("export const WA_DOWN_MSG"), "نصُّ «غير متصل» لم يعد ثابتةً واحدة");
    // النسختان المضمّنتان القديمتان (بنصّ «— اربطه» الكامل) أُبدلتا بالثابتة — نصٌّ يتغيّر
    // في موضعٍ ويُفلت من مِجسّ isWaDown. (نسخةُ المُرحِّل القصيرةُ «غير متصل» شأنٌ آخر.)
    assert.ok(!wa.includes('error: "واتساب المكتب غير متصل — اربطه'), "عاد النصُّ الكاملُ مضمّناً — سيتباعد عن مِجسّ isWaDown يوماً");
  });

  test("٢ · الإنعاشُ داخل الدفعة: ترقّبُ عودة العميل ثمّ إعادةُ محاولة المشترك نفسِه", () => {
    const s = SCHED();
    assert.ok(s.includes("async function waitWaRevival"), "دالّةُ الترقّب ضاعت");
    assert.ok(s.includes("WA_REVIVAL_MAX_MS = 8 * 60_000"), "مهلةُ الترقّب تغيّرت عن المقيس (~٧ دقائق للعودة)");
    assert.ok(s.includes("if (await waitWaRevival(sub.towerId))"), "الدفعةُ لا تترقّب الإنعاش قبل إعادة المحاولة");
    assert.ok(s.includes("deadWaOffices.add(sub.towerId)"), "المكتبُ الميّتُ لا يُعلَن — فتحترق البقيّةُ صفوفَ فشل");
    assert.ok(s.includes("deadWaOffices.has(sub.towerId)) continue"), "مشتركو المكتب الميّت لا يُتخطَّون — عادت حرائقُ الـ٦١ صفّاً");
  });

  test("٣ · الفشلُ الغالبُ يفكّ ختمَ اليوم — لا تكفي يتيمةٌ ناجحةٌ لختم ٦١ فاشلة", () => {
    const s = SCHED();
    assert.ok(s.includes("deadWaOffices.has(id) || (offFailed.get(id) ?? 0) > (offSent.get(id) ?? 0)"),
      "شرطُ فكّ الختم عاد إلى «فشل كلُّه» — نجاحُ يتيمةٍ يختم يومَ مكتبٍ محترق");
  });

  test("٤ · دورةُ القضاء: يومٌ غيرُ مختومٍ مضى وقتُه يُعاد كلَّ ٢٠ دقيقةً في نفس اليوم", () => {
    const s = SCHED();
    assert.ok(s.includes("const reminderCatchupAt = new Map<number, number>()"), "خانقُ القضاء ضاع — كرونُ الدقيقة سيقصف بلا رحمة");
    assert.ok(s.includes("o.lastReminderDate === todayK) return false"), "القضاءُ لا يستثني المختومَ — ازدواجُ إرسالٍ محتمل");
    assert.ok(s.includes("< 20 * 60_000) return false"), "فاصلُ الـ٢٠ دقيقةً بين المحاولات ضاع");
    assert.ok(s.includes('expiring-catchup'), "دورةُ القضاء نفسُها ضاعت من الموزّع");
  });
});
