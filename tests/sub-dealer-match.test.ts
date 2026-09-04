import { test } from "node:test";
import assert from "node:assert/strict";
import { findSuspects, scoreMatch, type SasSub } from "@/lib/subDealerMatch";

// ═══════ 🕵️ مُطابِقُ «سب-ديلر» — قفلُ الدقّة على قاعدةٍ يحرسها اختبار ═══════
//
// طلبُ محمد كان «مقترحاً قوياً» عاليَ الدقّة: يُطابِق بالاسم الكامل، أو ناقصِ اللقب،
// أو الأخِ (الأب+الجدّ)، أو باسم الأب، أو الهاتف — دون أن يُطلقَ إنذاراً كاذباً على
// **اسمٍ أوّلٍ شائعٍ وحده** (محمد/علي/أحمد). هذا الملفُّ يجعل ذلك قاعدةً: أيُّ تعديلٍ
// يُرخي المُطابِقَ فيُطابِق على اسمٍ مفردٍ **يُفشل `npm test`** قبل الإنتاج.

const sub = (p: Partial<SasSub> & { name: string }): SasSub => ({
  sasId: 1, username: p.username ?? "u" + Math.random(), name: p.name, phone: p.phone ?? null,
  expiration: p.expiration ?? null, days: p.days ?? 0, enabled: p.enabled ?? true, packageName: null,
  activatedAt: p.activatedAt ?? null,
});

// حالةٌ إيجابيّةٌ زائفة يجب ألّا تُطابَق: اسمٌ أوّلٌ شائعٌ وحده (أبي = اسمُ الآخر الأوّل)
test("no false positive on single shared common name", () => {
  const a = scoreMatch(sub({ name: "علي محمد حسن" }), sub({ name: "محمد سعد جبار" }));
  assert.ok(a.score < 45, `expected <45 got ${a.score} (${a.signals})`);
});

test("full name matches high", () => {
  const a = scoreMatch(sub({ name: "علي حسن جاسم" }), sub({ name: "علي حسن جاسم" }));
  assert.equal(a.score, 90);
});

test("dropped surname (prefix)", () => {
  const a = scoreMatch(sub({ name: "علي حسن جاسم" }), sub({ name: "علي حسن جاسم كريم" }));
  assert.equal(a.score, 80);
});

test("brother = same father+grandfather diff first", () => {
  const a = scoreMatch(sub({ name: "علي حسن جاسم" }), sub({ name: "محمد حسن جاسم" }));
  assert.equal(a.score, 50);
  assert.ok(a.signals.some((s) => s.includes("أخ")));
});

test("registered under father name (consecutive chain)", () => {
  // مشتركي: محمد عبدالكاظم جاسم ⇒ الأب حسابُه: عبد الكاظم جاسم محمد
  const a = scoreMatch(sub({ name: "محمد عبد الكاظم جاسم" }), sub({ name: "عبد الكاظم جاسم محمد" }));
  assert.ok(a.score >= 55, `expected >=55 got ${a.score}`);
});

test("phone beats all", () => {
  const a = scoreMatch(sub({ name: "لا تشابه اطلاقا هنا", phone: "07701234567" }), sub({ name: "مختلف تماما ايضا", phone: "07701234567" }));
  assert.equal(a.score, 100);
});

test("findSuspects: only expired-with-date matched to in-range active", () => {
  const mine: SasSub[] = [
    sub({ name: "علي حسن جاسم", days: -5, expiration: "2026-08-01" }), // منتهٍ
    sub({ name: "بلا تاريخ انتهاء", days: 0, expiration: null }),        // days=0 زائف ⇒ يُستبعَد
  ];
  const uni: SasSub[] = [
    sub({ name: "علي حسن جاسم", days: 20, enabled: true, activatedAt: "2026-08-20", username: "other1" }),
  ];
  const r = findSuspects(mine, uni);
  assert.equal(r.length, 1);
  assert.equal(r[0].mine.name, "علي حسن جاسم");
  assert.equal(r[0].gapDays, 19);
});
