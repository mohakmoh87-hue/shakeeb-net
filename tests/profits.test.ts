import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Rules, cabinetOfUser, daysInMonth, monthRange, monthLabel, rangeWarning, ACT_RECEIPT_MS, INSTALL_RECEIPT_MS } from "@/lib/profits";

// ═════ 📈 أرباحُ الشركة — إملاءُ محمد 2026-08-22 ═════
//   · خمسةُ مربّعات: تفعيلٌ داخليّ/خارجيّ **بالأشهر**، وتنصيبٌ داخليّ/خارجيّ **مرّةً واحدة**،
//     والخامسُ الصافي = المجموع − الاستقطاعات.
//   · الفيصلُ بين «داخل المكتب» و«خارجيّ» هو **وجودُ وصلٍ في البرنامج** لا مكانُ التفعيل.
//   · النسبةُ من **سعر بيع الباقة المسجَّل** لا من كلفة شراء الكارت.
//   · «شهر جديد» يُصفّر، و«من ١» يوجب «إلى» آخرَ يومٍ في ذلك الشهر فعليّاً وإلّا تنبيه.
//   · ولا أثرَ ماليّ إطلاقاً — أرقامٌ للقراءة فقط.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const LIB = () => read("src/lib/profits.ts");

describe("🏷️ الكابينةُ تُشتقّ من اليوزر", () => {
  test("bg-47-33-1@shu ⇒ ٤٧", () => assert.equal(cabinetOfUser("bg-47-33-1@shu"), 47));
  test("bg-5-12-11@mu ⇒ ٥", () => assert.equal(cabinetOfUser("bg-5-12-11@mu"), 5));
  test("يوزرٌ بصيغةٍ غريبة ⇒ صفر (لا كابينة)", () => assert.equal(cabinetOfUser("abc@shu"), 0));
});

describe("🧮 قواعدُ الربح — ثلاثُ طبقاتٍ ترث", () => {
  const rules = new Rules([
    { towerId: 0, cabinet: 0, kind: "act", packageId: 0, mode: "percent", percent: 20, amount: null },
    { towerId: 6, cabinet: 0, kind: "act", packageId: 0, mode: "percent", percent: 25, amount: null },
    { towerId: 6, cabinet: 53, kind: "act", packageId: 0, mode: "fixed", percent: null, amount: null },
    { towerId: 6, cabinet: 53, kind: "act", packageId: 9, mode: null, percent: null, amount: 6000 },
    { towerId: 0, cabinet: 0, kind: "instIn", packageId: 9, mode: null, percent: null, amount: 10000 },
    { towerId: 0, cabinet: 0, kind: "instExt", packageId: 9, mode: null, percent: null, amount: 4000 },
    { towerId: 0, cabinet: 0, kind: "deductIn", packageId: 9, mode: null, percent: null, amount: 1500 },
    { towerId: 0, cabinet: 0, kind: "deductExt", packageId: 9, mode: null, percent: null, amount: 3000 },
  ]);

  test("العامُّ يسري حين لا أخصَّ منه: ٢٠٪ من ٤٥٬٠٠٠", () => {
    assert.equal(rules.actPerMonth(5, 34, 9, 45000), 9000);
  });
  test("والمكتبُ يغلب العامّ: ٢٥٪ في مكتب ٦", () => {
    assert.equal(rules.actPerMonth(6, 47, 9, 45000), 11250);
  });
  test("والكابينةُ تغلبهما: FDT53 ثابتٌ ٦٬٠٠٠ مهما كان سعرُ الباقة", () => {
    assert.equal(rules.actPerMonth(6, 53, 9, 45000), 6000);
  });
  test("التنصيبُ الداخليُّ والخارجيُّ رقمان مختلفان", () => {
    assert.equal(rules.installProfit(6, 53, 9, false), 10000);
    assert.equal(rules.installProfit(6, 53, 9, true), 4000);
  });
  test("والاستقطاعُ **رقمان مختلفان** (تصحيحُ محمد): داخليٌّ ١٬٥٠٠ وخارجيٌّ ٣٬٠٠٠", () => {
    assert.equal(rules.deduction(6, 53, 9, false), 1500);
    assert.equal(rules.deduction(6, 53, 9, true), 3000);
    assert.equal(rules.deduction(5, 34, 9, false), 1500);
  });
  test("بلا قاعدةٍ ⇒ صفرٌ لا خطأ", () => {
    assert.equal(new Rules([]).actPerMonth(6, 53, 9, 45000), 0);
  });
});

describe("📅 الشهرُ وحدودُه", () => {
  test("عددُ الأيّام فعليٌّ: شباط ٢٠٢٦ = ٢٨ · آب = ٣١ · نيسان = ٣٠", () => {
    assert.equal(daysInMonth(2026, 1), 28);
    assert.equal(daysInMonth(2026, 7), 31);
    assert.equal(daysInMonth(2026, 3), 30);
  });
  test("الوضعُ الشهريُّ يضبط الطرفَين بلا كتابةِ تاريخ", () => {
    const r = monthRange(2026, 7); // آب
    assert.equal(r.from.toISOString(), "2026-07-31T21:00:00.000Z"); // ١ آب ٠٠:٠٠ بغداد
    assert.equal(r.to.toISOString(), "2026-08-31T20:59:59.999Z");   // ٣١ آب ٢٣:٥٩ بغداد
  });
  test("العنوانُ باسم الشهر: «أرباحُ الشهر الثامن»", () => {
    assert.equal(monthLabel(monthRange(2026, 7).from), "أرباحُ الشهر الثامن");
  });
});

describe("⚠️ تنبيهُ المدى — «من ١» يوجب آخرَ يومٍ فعليّ", () => {
  const d = (s: string) => new Date(`${s}T00:00:00+03:00`);
  const dEnd = (s: string) => new Date(`${s}T23:59:59+03:00`);
  test("١ ← ٣١ في آب ⇒ لا تنبيه", () => assert.equal(rangeWarning(d("2026-08-01"), dEnd("2026-08-31")), null));
  test("١ ← ٣٠ في آب ⇒ تنبيهُ «أقلّ من الشهر»", () => {
    const w = rangeWarning(d("2026-08-01"), dEnd("2026-08-30"));
    assert.ok(w && w.includes("أقلُّ من الشهر"), "لا تنبيهَ لمدّةٍ ناقصة");
  });
  test("١ ← ٢ أيلول ⇒ تنبيهُ «أكثر من الشهر»", () => {
    const w = rangeWarning(d("2026-08-01"), dEnd("2026-09-02"));
    assert.ok(w && w.includes("أكثرُ من الشهر"), "لا تنبيهَ لمدّةٍ زائدة");
  });
  test("ومدًى لا يبدأ بيوم ١ ⇒ بلا تنبيهٍ أصلاً (اختيارٌ حرّ)", () => {
    assert.equal(rangeWarning(d("2026-08-05"), dEnd("2026-08-20")), null);
  });
});

describe("🔒 نوافذُ الوصل كما أقرّها محمد", () => {
  test("التفعيل ±٣ أيّام · التنصيب ٧ أيّام", () => {
    assert.equal(ACT_RECEIPT_MS, 3 * 86400_000);
    assert.equal(INSTALL_RECEIPT_MS, 7 * 86400_000);
  });
});

describe("💰 صفرُ أثرٍ ماليّ — شرطُ محمد الأوّل", () => {
  const forbidden = ["subscriptionEntry.create", "subscriptionEntry.update", "moneyTx", "prisma.debt", "carry:", "rechargeCard.update"];
  for (const f of forbidden) {
    test(`لا «${f}» في محرّك الأرباح`, () => assert.ok(!LIB().includes(f), `الأرباحُ تمسّ مالاً عبر ${f}`));
  }
  test("ولا في مسارَي الواجهة", () => {
    const a = read("src/app/api/manager/profits/route.ts") + read("src/app/api/manager/profit-rules/route.ts");
    for (const f of forbidden) assert.ok(!a.includes(f), `مسارُ الأرباح يمسّ مالاً عبر ${f}`);
  });
  test("والنسبةُ من سعر البيع لا من كلفة الكارت", () => {
    const s = LIB();
    assert.ok(s.includes("priceDinar: true"), "لا يُقرأ سعرُ البيع");
    assert.ok(!s.includes("cardCost"), "قرأ كلفةَ شراء الكارت — وهي ليست سعرَ البيع");
  });
});

describe("🔗 الوصلُ والعزلُ والتهيئة", () => {
  test("الفيصلُ وجودُ الوصل: تفعيلٌ له وصلٌ لا يُعدّ خارجيّاً", () => {
    assert.ok(LIB().includes("if (sub && hasReceiptAround(sub.id, at, ACT_RECEIPT_MS)) continue;"), "لم يُطبَّق فيصلُ الوصل");
  });
  test("والتنصيبُ يُحسَب مرّةً واحدةً لكلّ مشترك", () => {
    assert.ok(LIB().includes("if (installSeen.has(key)) continue;"), "التنصيبُ قد يتكرّر");
  });
  test("والقرضُ لا ربحَ فيه", () => {
    assert.ok(LIB().includes("if (isLoan) continue;"), "القرضُ يدخل الأرباح");
  });
  test("🔒 العزل: الوكيلُ من الجلسة والمكاتبُ من صلاحيّته", () => {
    const a = read("src/app/api/manager/profits/route.ts");
    assert.ok(a.includes('guard("manager.accounts")'), "بلا صلاحيّة");
    assert.ok(a.includes("agentTowerIds(g.session ?? null)"), "بلا عزلِ مكاتب");
    const r = read("src/app/api/manager/profit-rules/route.ts");
    assert.ok(r.includes('return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });'), "يُقبَل مكتبُ غيرِك");
  });
  test("⏳ خامدةٌ حتى تهيئة الجدول (P2021) لا تسقط الصفحة", () => {
    assert.ok(LIB().includes("if (tableMissing(e)) return { rules: new Rules([]), dormant: true, rows: [] };"), "غيابُ الجدول يُسقط الصفحة");
    assert.ok(fs.existsSync(path.join(process.cwd(), "docs/sql/profit-rules.sql")), "لا سطرَ SQL جاهزاً للصق");
  });
  test("🚧 ولا يُحسَب ما قبل لحظة التأسيس", () => {
    assert.ok(read("src/app/api/manager/profits/route.ts").includes("range.from < period.epoch ? period.epoch : range.from"), "يُحسَب القديم");
  });
});

describe("🖥️ الشاشة", () => {
  test("خمسةُ مربّعاتٍ وزرُّ «شهر جديد»", () => {
    const ui = read("src/components/ProfitsPanel.tsx");
    for (const t of ["تفعيلات داخل المكتب", "تفعيلات خارجية", "تنصيبات داخل المكتب", "تنصيبات خارجية", "شهر جديد"]) {
      assert.ok(ui.includes(t), `«${t}» غائبٌ عن الشاشة`);
    }
    assert.ok(ui.includes("grid-cols-2 gap-2 md:grid-cols-4"), "المربّعاتُ ليست ٢×٢ على الهاتف");
  });
  test("والتسميتان الجديدتان في حسابات المدير", () => {
    const p = read("src/app/(app)/manager-accounts/page.tsx");
    assert.ok(p.includes(`["tx", "💵", "حركةٌ جديدة",`), "لم تُختصر تسميةُ الحركة");
    assert.ok(p.includes(`["cardprice", "💳", "أسعار الكروت",`), "لم تُغيَّر تسميةُ أسعار الكروت");
    assert.ok(p.includes(`["profits", "📈", "أرباح الشركة", true, 0],`), "زرُّ الأرباح غائب");
    assert.ok(!p.includes("سعر الكارت لكل فئة"), "بقيت التسميةُ القديمة");
  });
});

describe("🔒 تصحيحا محمد بعد أوّل نشر (2026-08-22)", () => {
  test("الاستقطاعُ يُقرأ بنوعَيه لا بنوعٍ واحد", () => {
    const lib = LIB();
    assert.ok(lib.includes('external ? "deductExt" : "deductIn"'), "الاستقطاعُ ما زال واحداً");
    // 🏢📄 الداخليُّ من العقود (external=false) والخارجيُّ من «العرض» (external=true) — نوعان مختلفان
    assert.ok(lib.includes("rules.deduction(ci.towerId, cabinet, pkgId, false)"), "الداخليُّ (من العقود) لا يستقطع بنوعه");
    assert.ok(lib.includes("rules.deduction(r.towerId, cabinet, pkg?.id ?? 0, true)"), "الخارجيُّ لا يستقطع بنوعه");
    const ui = read("src/components/ProfitsPanel.tsx");
    assert.ok(ui.includes("deductIn") && ui.includes("deductExt"), "الشاشةُ بخانةِ استقطاعٍ واحدة");
  });

  test("و«شهر جديد» مقفلٌ حتى ينقضي الشهر — بالخادم لا بالواجهة وحدَها", () => {
    const api = read("src/app/api/manager/profits/route.ts");
    assert.ok(api.includes("if (!cur.ended) {"), "الخادمُ يقبل تصفيرَ شهرٍ لم ينتهِ");
    const ui = read("src/components/ProfitsPanel.tsx");
    assert.ok(ui.includes("disabled={busy || !canNewMonth}"), "الزرُّ مفتوحٌ في منتصف الشهر");
  });
});

describe("🏢 ترشيحُ مكتبٍ واحد (طلبُ محمد 2026-08-22)", () => {
  test("الخادمُ يقبل رقمَ مكتبٍ من مكاتبه ويُسقط غيرَه (عزل)", () => {
    const api = read("src/app/api/manager/profits/route.ts");
    assert.ok(api.includes("const askTower = Number(sp.get(\"tower\")) || 0;"), "لا ترشيحَ بالمكتب");
    assert.ok(api.includes("askTower && towers.includes(askTower) ? [askTower] : towers"), "الترشيحُ بلا عزل");
    assert.ok(api.includes("computeProfits(agentId, scope, from, range.to)"), "الحسابُ لا يحترم الترشيح");
  });
  test("والشاشةُ فيها قائمةُ «كلّ المكاتب» وأسماءُ مكاتبه", () => {
    const ui = read("src/components/ProfitsPanel.tsx");
    assert.ok(ui.includes("كلّ المكاتب"), "لا قائمةَ مكاتب");
    assert.ok(ui.includes("tower ? `tower=${tower}` : \"\""), "الاختيارُ لا يُرسَل للخادم");
  });
});
