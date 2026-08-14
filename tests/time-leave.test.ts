import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeAttendance } from "../src/lib/attendance";

// ═══════ الإجازةُ الزمنيّة: تُزيح حدَّ الدوام لذلك اليوم وحدَه (طلبُ محمد 2026-08-14) ═══════
// المثالُ الحاكمُ بنصّه: **موظّفٌ دوامُه ١٢:٠٠ ظهراً ← ١١:٠٠ ليلاً.**
// ⛔ والحالةُ ٣ (إجازةٌ وسطَ الدوام ⇒ بصمتان في يوم) **ألغاها محمد** — فلا تُزيح شيئاً.
const TECH = {
  shiftStart: "12:00", shiftEnd: "23:00",
  entryGraceMin: 0, exitGraceMin: 0,
  lateRatePerMin: 100, overtimeRatePerMin: 50,
};
/** بصمةٌ بتوقيت بغداد (UTC+3) لليوم نفسِه */
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 14, h - 3, m, 0));

describe("الإجازةُ الزمنيّةُ المعتمدة", () => {
  test("بلا إجازة: دخولٌ ٤ عصراً على دوامٍ ١٢ ⇒ خصمُ ٢٤٠ دقيقة (الأساسُ لم يتغيّر)", () => {
    const r = computeAttendance(TECH, at(16), at(23));
    assert.equal(r.lateMinutes, 240);
    assert.equal(r.lateDeduction, 24000);
  });

  test("🕐 الحالة ١ · إجازةٌ ١٢←٤ تُزيح **بدايةَ** الدوام ⇒ صفرُ تأخير", () => {
    // «بصمةُ دخوله أصلاً ١٢، فبعد موافقة المدير تنتقل إلى ٤ عصراً — في هذا اليوم فقط»
    const r = computeAttendance(TECH, at(16), at(23), { startMin: 12 * 60, endMin: 16 * 60 });
    assert.equal(r.lateMinutes, 0, "ما زال يُخصَم رغم إذن المدير");
    assert.equal(r.lateDeduction, 0);
    assert.equal(r.earlyMinutes, 0, "خرج بوقته فلا خصمَ خروج");
  });

  test("🕐 الحالة ٢ · إجازةٌ ٩←١١ ليلاً تُزيح **نهايةَ** الدوام ⇒ صفرُ خروجٍ مبكّر", () => {
    const r = computeAttendance(TECH, at(12), at(21), { startMin: 21 * 60, endMin: 23 * 60 });
    assert.equal(r.earlyMinutes, 0, "خروجُه ٩ بإذنٍ ما زال يُخصَم");
    assert.equal(r.earlyDeduction, 0);
    assert.equal(r.overtimeMinutes, 0, "ولا يُحسب إضافيّاً أيضاً");
  });

  test("⛔ الحالة ٣ ملغاة · إجازةٌ وسطَ الدوام (٥←٦) لا تُزيح حدّاً", () => {
    // ألغى محمد «بصمتين في يومٍ واحد» ⇒ لا مقاطعَ حضور، والحدودُ تبقى كما هي
    const r = computeAttendance(TECH, at(16), at(23), { startMin: 17 * 60, endMin: 18 * 60 });
    assert.equal(r.lateMinutes, 240, "أزاحت إجازةٌ وسطيّةٌ بدايةَ الدوام — والحالةُ ملغاة");
  });

  test("🛡️ ولا تُقلَب الحدود: إجازةٌ تبتلع الدوامَ كلَّه لا تجعل النهايةَ قبل البداية", () => {
    const r = computeAttendance(TECH, at(12), at(23), { startMin: 0, endMin: 24 * 60 });
    assert.ok(Number.isFinite(r.lateDeduction) && r.lateDeduction >= 0, "خصمٌ سالبٌ أو غيرُ رقميّ");
    assert.ok(Number.isFinite(r.earlyDeduction) && r.earlyDeduction >= 0);
  });

  test("🔒 والمصدرُ معتمدٌ حصراً: الجالبُ يشترط status=approved و kind=time", () => {
    const f = fs.readFileSync(path.join(process.cwd(), "src/lib/field.ts"), "utf8");
    assert.match(f, /approvedTimeLeaveFor/, "لا جالبَ للإجازة الزمنيّة");
    assert.match(f, /kind: "time", status: "approved"/, "تُقبل إجازةٌ غيرُ معتمدة — «إن لم يوافق لا تُحسَب»");
    assert.match(f, /isDeleted: false/, "تُقرأ إجازةٌ محذوفة");
  });

  test("⛓️ ومربوطةٌ بمسارات البصمة الثلاثة (خروجُ الفنيّ · التلقائيّ · إغلاقُ المدير)", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/field/attendance/route.ts"), "utf8");
    const auto = fs.readFileSync(path.join(process.cwd(), "src/lib/autoCheckout.ts"), "utf8");
    assert.equal((route.match(/approvedTimeLeaveFor/g) ?? []).length >= 2, true, "مسارُ البصمة لا يقرأ الإجازة في موضعَيه");
    assert.match(auto, /approvedTimeLeaveFor/, "الخروجُ التلقائيُّ يتجاهل الإجازة فيُخصَم ليلاً");
  });
});
