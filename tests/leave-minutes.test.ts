// ===== حصّةُ دقائق الإجازة الزمنيّة + مسحُ الخصم بقدر الدقائق (قرارُ محمد 2026-10-31) =====
//   node --import tsx --test "tests/**/*.test.ts"
//
// ثلاثُ قواعدَ تُحرَس هنا: (١) الحدُّ بالدقائق لا بالعدد، وفارغُه = بلا حدّ (سلوكُ ما قبل
// الميزة)؛ (٢) الموافقةُ المتأخّرةُ تمسح **بقدر دقائق الإجازة وحدَها** لا خصمَ اليوم كلَّه؛
// (٣) ولا تزيد مالاً أبداً — لا خصمٌ يرتفع ولا إضافيٌّ يُخلَق.
import { test, describe } from "node:test";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { computeAttendance, forgiveByTimeLeave, type TechShift } from "../src/lib/attendance";
import { timeMinutesQuota, sumLeaveMinutes } from "../src/lib/salary";

const T: TechShift = {
  shiftStart: "12:00", shiftEnd: "23:00",
  entryGraceMin: 0, exitGraceMin: 0,
  lateRatePerMin: 100, overtimeRatePerMin: 50,
};
const at = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00+03:00`);
const stored = (checkIn: string, checkOut: string) => {
  const c = computeAttendance(T, at(checkIn), at(checkOut));
  return { lateMinutes: c.lateMinutes, earlyMinutes: c.earlyMinutes, lateDeduction: c.lateDeduction, earlyDeduction: c.earlyDeduction };
};

describe("حصّةُ الدقائق", () => {
  test("فارغٌ أو صفرٌ = بلا حدّ، والرقمُ حدٌّ", () => {
    assert.equal(timeMinutesQuota(null), null);
    assert.equal(timeMinutesQuota({ leaveMinutesPerMonth: null }), null);
    assert.equal(timeMinutesQuota({ leaveMinutesPerMonth: 0 }), null);
    assert.equal(timeMinutesQuota({ leaveMinutesPerMonth: 120 }), 120);
  });

  test("الجمعُ بالدقائق لا بعدد الطلبات، ويتجاهل الناقصَ والمقلوب", () => {
    assert.equal(sumLeaveMinutes([{ startMin: 720, endMin: 780 }, { startMin: 900, endMin: 930 }]), 90);
    assert.equal(sumLeaveMinutes([{ startMin: null, endMin: 780 }, { startMin: 900, endMin: 900 }, { startMin: 950, endMin: 900 }]), 0);
  });
});

describe("مسحُ الخصم بقدر الدقائق", () => {
  test("إجازةٌ ١٢:٠٠←١٦:٠٠ ودخولٌ ١٦:٠٥ ⇒ يبقى خصمُ خمسِ دقائقَ وحدَها", () => {
    const s = stored("16:05", "23:00");
    assert.equal(s.lateDeduction, 24500);
    const fg = forgiveByTimeLeave(T, at("16:05"), at("23:00"), { startMin: 720, endMin: 960 }, s);
    assert.equal(fg.lateDeduction, 500);
    assert.equal(fg.lateMinutes, 5);
    assert.equal(fg.cleared, 24000);
  });

  test("إجازةُ آخرِ الدوام ٢١:٠٠←٢٣:٠٠ وخروجٌ ٢١:٠٠ ⇒ يُمسَح خصمُ الخروج المبكّر كلُّه", () => {
    const s = stored("12:00", "21:00");
    assert.equal(s.earlyDeduction, 12000);
    const fg = forgiveByTimeLeave(T, at("12:00"), at("21:00"), { startMin: 1260, endMin: 1380 }, s);
    assert.equal(fg.earlyDeduction, 0);
    assert.equal(fg.cleared, 12000);
  });

  test("🔑 إجازةٌ وسطَ الدوام لا تمسح تأخيرَ الصباح (كانت تمسح اليومَ كلَّه)", () => {
    const s = stored("12:30", "23:00");
    assert.equal(s.lateDeduction, 3000);
    const fg = forgiveByTimeLeave(T, at("12:30"), at("23:00"), { startMin: 1020, endMin: 1080 }, s);
    assert.equal(fg.cleared, 0);
    assert.equal(fg.lateDeduction, 3000);
  });

  test("إجازةٌ أقصرُ من التأخير ⇒ تُعفي قدرَها فقط", () => {
    const s = stored("13:00", "23:00");
    assert.equal(s.lateDeduction, 6000);
    const fg = forgiveByTimeLeave(T, at("13:00"), at("23:00"), { startMin: 720, endMin: 750 }, s);
    assert.equal(fg.lateMinutes, 30);
    assert.equal(fg.cleared, 3000);
  });

  test("🔒 لا تزيد مالاً: خصمٌ مخزَّنٌ صفرٌ يبقى صفراً، ولا تُحتسَب إضافيّاً", () => {
    const fg = forgiveByTimeLeave(T, at("12:00"), at("23:00"), { startMin: 1260, endMin: 1380 }, { lateMinutes: 0, earlyMinutes: 0, lateDeduction: 0, earlyDeduction: 0 });
    assert.equal(fg.lateDeduction, 0);
    assert.equal(fg.earlyDeduction, 0);
    assert.equal(fg.cleared, 0);
    assert.equal(Object.keys(fg).includes("overtimeAddition"), false);
  });

  test("بلا إجازةٍ معتمدةٍ لا يُمسَح شيء", () => {
    const s = stored("16:05", "23:00");
    assert.equal(forgiveByTimeLeave(T, at("16:05"), at("23:00"), null, s).cleared, 0);
  });
});

// ── حرّاسُ المسار: ما لا يُقاس بدالّةٍ نقيّة ───────────────────────────────
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("حرّاسُ مسار الإجازات", () => {
  const src = read("src/app/api/field/leaves/route.ts");

  test("طلبُ الفنيّ الزمنيَّ واعتمادُ المدير كلاهما يفحص الدقائق (الرفضُ قرارُ محمد)", () => {
    assert.equal((src.match(/usedTimeMinutesInPeriod\(/g) ?? []).length >= 4, true);
    assert.match(src, /حصّةُ دقائق الإجازة الزمنيّة لهذه الفترة/);
    assert.match(src, /استُنفدت حصّةُ دقائق الإجازة الزمنيّة/);
  });

  test("المعلَّقةُ تحجز الدقائقَ كالمدفوعة", () => {
    const fn = src.slice(src.indexOf("async function usedTimeMinutesInPeriod"));
    assert.match(fn.slice(0, 600), /status: \{ in: \["approved", "pending"\] \}/);
  });

  test("الاعتمادُ يعيد الفحصَ مستثنياً الطلبَ نفسَه (وإلّا حُجزت دقائقُه مرّتَين)", () => {
    assert.match(src, /usedTimeMinutesInPeriod\(leave\.technicianId, period\.from, period\.to, leave\.id\)/);
  });

  test("المسحُ بإعادة الحساب لا بتصفيرٍ أعمى", () => {
    assert.match(src, /forgiveByTimeLeave\(sh, rec\.checkIn, rec\.checkOut, tl, rec\)/);
    assert.equal(src.includes("lateDeduction: 0, earlyDeduction: 0,"), false);
  });

  test("الكتابةُ محروسةٌ بالقيم المقروءة وبعدم الختم بكشفٍ (لا طرحٌ مرّتَين)", () => {
    assert.match(src, /where: \{ id: rec\.id, salaryStatementId: null, lateDeduction: rec\.lateDeduction, earlyDeduction: rec\.earlyDeduction \}/);
    assert.match(src, /deductionClearedAmount: \(rec\.deductionClearedAmount \?\? 0\) \+ fg\.cleared/);
  });

  test("يومٌ مختومٌ بكشفٍ لا يُمسَح، ويُقال ذلك صريحاً", () => {
    assert.match(src, /مختومٌ بكشف راتبٍ مصروف/);
  });
});

describe("حارسُ الحصّة في لوحة المدير", () => {
  test("لوحةُ التفاصيل تقرأ أعمدةَ الحصّة كاملةً (كانت بلا تعديل الـ±)", () => {
    const src = read("src/app/api/field/leaves/route.ts");
    assert.match(src, /where: \{ id: reqTech, isDeleted: false \}, select: \{ id: true, name: true, towerId: true, agentId: true, \.\.\.QUOTA_FIELDS, \.\.\.TIME_QUOTA_FIELDS \}/);
  });
});
