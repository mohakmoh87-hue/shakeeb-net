// ===== الطبقة ١ و٢: حسابُ الراتب — دوالٌّ نقيّةٌ بلا قاعدة =====
//   node --import tsx --test "tests/**/*.test.ts"
//
// المبدأ: الاختباراتُ **المارّة** تحرس السلوكَ الصحيحَ القائم (فلا يعود خطأٌ أُصلح).
// والاختباراتُ الموسومةُ `todo` هي **مواصفةُ قرارات محمد** التي لم تُبنَ بعد (بندا أ-١٦ و ب-٠٠)
// ⇒ تُنزَع منها `todo` واحدةً واحدةً كلّما لُبِّي بندُها، فيصير الإصلاحُ مقاساً لا مظنوناً.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeSalary, roundSalaryToCash, SALARY_CASH_STEP, dailyAmountFor,
  type SalaryAttendance, type SalaryMoneyTx, type SalaryAdjustment, type SalaryLeave,
} from "../src/lib/salary";

// ── مُعينات ─────────────────────────────────────────────────────────────────
const day = (n: number) => `2026-08-${String(n).padStart(2, "0")}`;
/** بصمةُ حضورٍ نظيفةٌ بلا خصمٍ ولا إضافيّ */
const present = (n: number): SalaryAttendance => ({
  dayKey: day(n), checkIn: new Date(`${day(n)}T09:00:00+03:00`),
  lateDeduction: 0, earlyDeduction: 0, overtimeAddition: 0,
});
const AUG = { from: day(1), to: day(31) };
const run = (
  salary: number,
  att: SalaryAttendance[],
  extra: {
    adj?: SalaryAdjustment[]; money?: SalaryMoneyTx[]; leaves?: SalaryLeave[]; carryIn?: number;
    negMode?: "carry" | "zero";
  } = {},
) => computeSalary(salary, att, extra.leaves ?? [], extra.adj ?? [], extra.money ?? [], day(31), AUG, extra.carryIn ?? 0, extra.negMode ?? "carry");

// ═══════════════════════════════════════════════════════════════════════════
describe("معدّلُ اليوم — الأساسُ الذي تنبع منه المئاتُ والوحدات", () => {
  test("آب ٣١ يوماً: ٥٠٠٬٠٠٠ ÷ ٣١ = ١٦٬١٢٩", () => {
    assert.equal(dailyAmountFor(500_000, day(15)), 16_129);
  });

  test("شهرٌ كاملٌ بحضورٍ تامّ يُنتج ٤٩٩٬٩٩٩ — دينارٌ أقلُّ من الراتب", () => {
    // هذه ليست علّةً نُصلحها، بل **سببُ طلب محمد للتقريب**: الرقمُ غيرُ قابلٍ للدفع بالورق.
    const r = run(500_000, Array.from({ length: 31 }, (_, i) => present(i + 1)));
    assert.equal(r.daysPaid, 31);
    assert.equal(r.baseEarned, 499_999);
    assert.equal(r.net, 499_999);
  });

  test("شباط ٢٨ يوماً يُسعِّر اليومَ أغلى (١٧٬٨٥٧) — فالفترةُ العابرةُ لشهرَين تتفاوت", () => {
    assert.equal(dailyAmountFor(500_000, "2026-02-10"), 17_857);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("أ-١٦ · تقريبُ الألف — «زيادةً دائماً، والمستفيدُ هو الفنيّ»", () => {
  test("الخُطوة ألفٌ", () => assert.equal(SALARY_CASH_STEP, 1000));

  test("مثالُ محمد حرفيّاً: له ١٠٠ ألفٍ ودينار ⇒ ١٠١ ألفاً", () => {
    assert.equal(roundSalaryToCash(100_001), 101_000);
  });

  test("عليه ١٠٠٬٠٠١ ⇒ عليه ١٠٠٬٠٠٠ (ينقص دَينُه دينارٌ — العمليّةُ بالعكس)", () => {
    assert.equal(roundSalaryToCash(-100_001), -100_000);
  });

  test("المضاعَفُ للألف لا يتغيّر (فلا يُطبع سطرُ تقريبٍ بصفر)", () => {
    assert.equal(roundSalaryToCash(100_000), 100_000);
    assert.equal(roundSalaryToCash(-100_000), -100_000);
    assert.equal(roundSalaryToCash(0), 0);
  });

  test("دَينٌ أقلُّ من ألفٍ يسقط — ونتيجتُه صفرٌ **موجب** لا `-0`", () => {
    const r = roundSalaryToCash(-500);
    assert.equal(r, 0);
    assert.ok(!Object.is(r, -0), "يجب ألّا يكون -0 (يُطبع «-0» ويكسر المقارنة الصارمة)");
  });

  test("الفرقُ المُضاف موجبٌ أبداً وبين ٠ و٩٩٩ — لأربعِ قيمٍ عشوائيّةِ الشكل", () => {
    for (const v of [1, 999, 1_000, 1_001, 438_739, 499_999, -1, -999, -500_612]) {
      const add = roundSalaryToCash(v) - v;
      assert.ok(add >= 0 && add < SALARY_CASH_STEP, `القيمة ${v} أعطت فرقاً ${add}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("أ-١٦ + ب-٠٠ · الصافي والمستحقُّ والمصروف والمُرحَّل", () => {
  test("`net` يبقى مجموعَ الخانات بالضبط ولا يمسّه التقريب", () => {
    const r = run(500_000, Array.from({ length: 31 }, (_, i) => present(i + 1)));
    const sum =
      r.baseEarned + r.overtime + r.bonuses + r.credits -
      r.attendanceDeductions - r.confirmedDeductions - r.advances;
    assert.equal(r.net, sum, "لو انفرط هذا لاختلف مجموعُ الخانات عن الصافي في الشاشة");
    assert.equal(r.net, 499_999);
  });

  test("موجب: يُصرف مقرَّباً ولا يُرحَّل شيء", () => {
    const r = run(500_000, Array.from({ length: 31 }, (_, i) => present(i + 1)));
    assert.equal(r.due, 499_999);
    assert.equal(r.roundedDue, 500_000);
    assert.equal(r.roundingAdd, 1, "سطرُ «تمّ إضافة هذا المبلغ لتقريب الراتب»");
    assert.equal(r.paid, 500_000);
    assert.equal(r.carryOut, 0);
  });

  test("سالب: لا صرفَ، ويُرحَّل الدَينُ بإشارته (خيارُ «تحويل المتبقّي»)", () => {
    // راتب ٣٠٠٬٠٠٠ · حضر ٢٠ يوماً · سلفةٌ ٣٠٠٬٠٠٠ ⇒ صافٍ سالب (سيناريو التدقيق)
    const r = run(300_000, Array.from({ length: 20 }, (_, i) => present(i + 1)), {
      money: [{ dayKey: day(5), moneyIn: 0, moneyOut: 300_000, notes: "سلفة" }],
    });
    assert.ok(r.net < 0, `المتوقّع صافياً سالباً، جاء ${r.net}`);
    assert.equal(r.paid, 0, "لا يُصرف شيءٌ على صافٍ سالب");
    assert.equal(r.carryOut, r.roundedDue, "يُرحَّل كاملاً");
    assert.ok(r.carryOut < 0, "المُرحَّلُ دَينٌ على الفنيّ");
    assert.ok(r.roundingAdd >= 0 && r.roundingAdd < 1000);
  });

  test("`carryIn` يدخل المستحقَّ بإشارته — فالدَينُ يُخصم من الشهر القادم", () => {
    const att = Array.from({ length: 31 }, (_, i) => present(i + 1));
    const a = run(500_000, att, { carryIn: 0 });
    const b = run(500_000, att, { carryIn: -100_000 });
    assert.equal(b.net, a.net, "carryIn لا يمسّ `net` — يمسّ المستحقَّ وحده");
    assert.equal(b.due, a.due - 100_000);
    assert.equal(b.paid, 400_000, "٤٩٩٬٩٩٩ − ١٠٠٬٠٠٠ = ٣٩٩٬٩٩٩ ⇒ يُقرَّب إلى ٤٠٠٬٠٠٠");
  });

  test("مستحقٌّ دون الألف يُقرَّب إلى ألفٍ كامل (زيادةً لصالح الفنيّ)", () => {
    const r = run(500_000, [present(1)], {
      money: [{ dayKey: day(1), moneyIn: 0, moneyOut: 15_429, notes: "سلفة" }],
    });
    assert.equal(r.net, 700, "١٦٬١٢٩ − ١٥٬٤٢٩");
    assert.equal(r.paid, 1_000);
    assert.equal(r.roundingAdd, 300);
  });

  test("الافتراضُ بلا `carryIn` = سلوكُ ما قبل البند حرفيّاً", () => {
    const att = [present(1), present(2)];
    const withDefault = computeSalary(500_000, att, [], [], [], day(31), AUG);
    assert.equal(withDefault.carryIn, 0);
    assert.equal(withDefault.due, withDefault.net);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("سلامةُ البنود — ما وجده التدقيقُ صحيحاً فيجب أن يبقى", () => {
  test("السلفةُ تُخصم والإضافةُ تُضاف (الجانبان معاً لا جانبٌ واحد)", () => {
    const r = run(500_000, [present(1)], {
      money: [
        { dayKey: day(1), moneyIn: 0, moneyOut: 5_000, notes: "سلفة" },
        { dayKey: day(2), moneyIn: 5_000, moneyOut: 0, notes: "أعادها" },
      ],
    });
    assert.equal(r.advances, 5_000);
    assert.equal(r.credits, 5_000);
    assert.equal(r.net, 16_129, "سلفةٌ أُعيدت ⇒ لا أثرَ على الصافي");
  });

  test("خصمُ التأخير بعُذرٍ مقبولٍ لا يُحتسب", () => {
    const late: SalaryAttendance = { ...present(1), lateDeduction: 4_250, lateExcuse: "approved" };
    const r = run(500_000, [late]);
    assert.equal(r.attendanceDeductions, 0, "العُذرُ المقبولُ يُعلّق الخصم");
  });

  test("خصمُ التأخير بلا عُذرٍ يُحتسب بمقداره المقيس", () => {
    const late: SalaryAttendance = { ...present(1), lateDeduction: 4_250 };
    const r = run(500_000, [late]);
    assert.equal(r.attendanceDeductions, 4_250, "١٧ دقيقة × ٢٥٠ — دليلُ واقعةٍ لا يُقرَّب");
    assert.equal(r.net, 16_129 - 4_250);
  });

  test("ما خارجَ الفترة لا يُحتسب", () => {
    const r = computeSalary(500_000, [present(1), present(2)], [], [], [], day(31), { from: day(2), to: day(31) });
    assert.equal(r.daysPaid, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (ب) · خيارا الراتب السالب والمُرحَّل — أُصلح فيها **صفرٌ حرفيٌّ** كان يمحو الدَّين:
// `statementForTechnician` كانت تُمرّر `carryIn = 0` دائماً، فـ`carryOut` يُخزَّن في
// `salary_statements` **ولا يُقرَأ أبداً** ⇒ خيارُ «رحِّل» (وهو الافتراضيّ) يُضيّع دَينَ
// الفنيّ صامتاً. وهذه المواصفةُ تحرس المعادلاتَ الأربع: due · paid · carryOut · collected.
describe("(ب) · المُرحَّلُ وخيارا الراتب السالب", () => {
  test("راتبٌ موجبٌ ⇒ لا مُرحَّلَ ولا استيفاء", () => {
    const r = run(500_000, [present(1), present(2), present(3)]);
    assert.ok(r.roundedDue > 0, "ثلاثةُ أيّامٍ حضورٍ تُنتج مستحقّاً موجباً");
    assert.equal(r.carryOut, 0, "الموجبُ يُصرف كاملاً فلا يبقى شيءٌ للترحيل");
    assert.equal(r.collected, 0);
  });

  test("مُرحَّلٌ سالبٌ من الفترة السابقة يُخصَم من هذه الفترة", () => {
    const base = run(500_000, [present(1), present(2), present(3)]);
    const withCarry = run(500_000, [present(1), present(2), present(3)], { carryIn: -20_000 });
    assert.equal(withCarry.net, base.net, "المُرحَّلُ لا يمسّ الصافيَ المحسوب — فهو ليس من عمل الفترة");
    assert.equal(withCarry.due, base.net - 20_000, "بل يُخصم من المستحقّ: due = net + carryIn");
    assert.ok(withCarry.roundedDue < base.roundedDue, "فينقص المدفوع فعلاً");
  });

  test("«رحِّل» ⇒ السالبُ يُرحَّل بإشارته ولا مالَ يُقبَض", () => {
    // يومٌ واحدٌ (١٦٬١٢٩) وسلفةٌ ١٠٠٬٠٠٠ ⇒ صافٍ سالب
    const r = run(500_000, [present(1)], {
      money: [{ dayKey: day(1), moneyIn: 0, moneyOut: 100_000, notes: "سلفة", txId: 1 }],
      negMode: "carry",
    });
    assert.ok(r.roundedDue < 0, "الصافي سالبٌ فعلاً");
    assert.equal(r.paid, 0, "لا يُصرف شيءٌ على السالب");
    assert.equal(r.carryOut, r.roundedDue, "يُرحَّل بالمقدار نفسِه وبإشارته — وهذا ما كان يُمحى");
    assert.equal(r.collected, 0, "«رحِّل» لا يقبض نقداً");
  });

  test("«صفِّر» ⇒ استيفاءٌ نقديٌّ بمقداره، لا محوٌ للدَّين", () => {
    const r = run(500_000, [present(1)], {
      money: [{ dayKey: day(1), moneyIn: 0, moneyOut: 100_000, notes: "سلفة", txId: 1 }],
      negMode: "zero",
    });
    assert.ok(r.roundedDue < 0);
    assert.equal(r.carryOut, 0, "لا يبقى مُرحَّلٌ بعد التصفير");
    assert.equal(r.collected, -r.roundedDue, "ويُقبَض مقدارُه نقداً (موجبٌ أبداً) — وإلّا كان التصفيرُ إخفاءَ مالٍ قُبض");
    assert.equal(r.paid, 0);
  });

  test("المُرحَّلُ لا يُلغي التقريبَ لمصلحة الفنيّ", () => {
    const r = run(500_000, [present(1), present(2), present(3)], { carryIn: -1_500 });
    assert.equal(r.roundedDue % 1000, 0, "المدفوعُ يبقى مضاعفاً للألف");
    assert.ok(r.roundingAdd >= 0 && r.roundingAdd < 1000, "والتقريبُ موجبٌ أبداً — المستفيدُ الفنيّ");
    assert.equal(r.roundedDue, r.due + r.roundingAdd);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⬇️ مواصفةُ ب-٠٠ — لم تُبنَ بعد. تُنزَع `todo` عند بناء كلّ بند.
describe("ب-٠٠ · مواصفةٌ لم تُبنَ بعد (تُفعَّل بنداً بنداً)", () => {
  test("تسديدُ راتبٍ سالبٍ يُدخل المال للصندوق: ١٠٠٬٠٠٠ − (−١٠٠) = ١٠٠٬١٠٠", { todo: "ب-٠٠ · مسار field/salary" }, () => {});
  test("تسديدُ دينٍ يتجاوزه ⇒ carry سالبٌ لا صفر (debts/[id]/pay:44)", { todo: "ب-٠٠ · الحرجة ١" }, () => {});
  test("تسديدُ مكتبٍ رصيدُه سالبٌ يُقلب صرفاً لا يُرفض (money/settlements:151)", { todo: "ب-٠٠ · الحرجة ٢" }, () => {});
  test("إرجاعُ قيدٍ لا يحذف تسديدةً بقيودٍ أخرى (money/settlements:113)", { todo: "ب-٠٠ · الحرجة ٣" }, () => {});
  test("إبطالُ فاتورةٍ لا يمحو ما سدّده المشترك (invoices/[id]/void:69)", { todo: "ب-٠٠ · الحرجة ٤" }, () => {});
  test("واصلٌ أكبرُ من الفاتورة يُقيَّد رصيداً لا إيراداً (invoices:181)", { todo: "ب-٠٠ · الحرجة ٥" }, () => {});
  test("«ما سحبه» يطرح المقبوضات (manager-accounts:66)", { todo: "ب-٠٠ · عالية" }, () => {});
  test("`/api/money` يرفض الكسر العشريّ (`.int()`)", { todo: "ب-٠٠ · جذرُ الكسر" }, () => {});
});

// ═══════════════════════════════════════════════════════════════════════════
// أ-٨ · يومٌ واحدٌ لا يُدفَع مرّتَين — إجازةٌ مدفوعةٌ + بصمةٌ في اليوم نفسِه.
// كانت حلقةُ الحضور تزيد `daysPaid` وحلقةُ الإجازة تزيده ثانيةً لليوم نفسِه بلا أيّ
// تقاطع، و**البصمةُ خاليةٌ من أيّ فحصِ إجازة** ⇒ أجرُ يومَين عن يومٍ واحد.
describe("أ-٨ · إجازةٌ مدفوعةٌ في يومٍ مبصومٍ لا تُحتسَب مرّتَين", () => {
  const paidLeave = (n: number): SalaryLeave => ({
    dayKey: day(n), kind: "day", paid: true, status: "approved", reason: "مرض",
  });

  test("بصمةٌ + إجازةٌ مدفوعةٌ في اليوم نفسِه ⇒ يومٌ واحدٌ لا يومان", () => {
    const both = run(500_000, [present(1)], { leaves: [paidLeave(1)] });
    const onlyAtt = run(500_000, [present(1)]);
    assert.equal(both.daysPaid, 1, "يومٌ واحدٌ فقط — وكان يُحتسب يومَين");
    assert.equal(both.baseEarned, onlyAtt.baseEarned, "والمبلغُ مبلغُ الحضور وحدَه");
    assert.equal(both.net, onlyAtt.net);
  });

  test("والإجازةُ تُعرَض بصفرٍ وبسببِ عدمِ احتسابها — لا تُحجَب", () => {
    const r = run(500_000, [present(1)], { leaves: [paidLeave(1)] });
    const line = r.items.find((i) => i.type === "leave-paid-skipped");
    assert.ok(line, "يجب أن يبقى سطرُ الإجازة ظاهراً — الحجبُ يُوهم أنّ يوماً سقط سهواً");
    assert.equal(line!.amount, 0);
    assert.equal(line!.reason, "مرض", "وسببُ الإجازة يبقى مكتوباً");
    assert.ok(!r.items.some((i) => i.type === "leave-paid"), "ولا يُكتَب سطرُ احتسابٍ لها");
  });

  test("إجازةٌ مدفوعةٌ في يومٍ **غيرِ** مبصومٍ تُحتسَب كما كانت (لا انحدار)", () => {
    const r = run(500_000, [present(1)], { leaves: [paidLeave(5)] });
    assert.equal(r.daysPaid, 2, "يومُ حضورٍ + يومُ إجازةٍ مدفوعة");
    assert.ok(r.items.some((i) => i.type === "leave-paid"), "وتُكتَب سطرَ احتساب");
    assert.equal(r.dayDetails.filter((d) => d.note === "إجازة براتب").length, 1);
  });

  test("إجازةٌ **بلا راتبٍ** في يومٍ مبصومٍ لا تُمَسّ (لم تكن تُحتسَب أصلاً)", () => {
    const unpaid: SalaryLeave = { dayKey: day(1), kind: "day", paid: false, status: "approved", reason: "خاصّ" };
    const r = run(500_000, [present(1)], { leaves: [unpaid] });
    assert.equal(r.daysPaid, 1);
    assert.ok(r.items.some((i) => i.type === "leave-unpaid"));
  });

  test("إجازةٌ غيرُ معتمدةٍ لا أثرَ لها بحالٍ", () => {
    const pending: SalaryLeave = { dayKey: day(2), kind: "day", paid: true, status: "pending", reason: "طلب" };
    const r = run(500_000, [present(1)], { leaves: [pending] });
    assert.equal(r.daysPaid, 1);
    assert.equal(r.items.filter((i) => i.type.startsWith("leave")).length, 0);
  });
});
