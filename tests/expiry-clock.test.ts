import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatExpiry, formatExpiryOrEmpty, formatBaghdadDateTime, expiryInstant, remaining, remainingText } from "@/lib/format";

// ═════ ⏰ ساعةُ الانتهاء ودقيقتُه — إملاءُ محمد 2026-08-21 ═════
//   ١· «المزامنةُ تجلب تاريخَ الانتهاء ولا تجلب في أيّ ساعةٍ ودقيقةٍ ينتهي بالضبط»
//      — والقياسُ أثبت أنّ الجلبَ يأتي بالوقت ويحفظه، والناقصُ **العرضُ** وحدَه.
//   ٢· «دائماً العرضُ هو يومٌ ساعةٌ دقيقة».
//   ٣· «كلُّ شيءٍ وحتى الرسالةُ التي تصله فيها اليومُ والساعةُ والدقيقة».
//   ٤· «صحّحه بالعرض فقط» — فلا تُمَسّ القاعدةُ ولا طريقةُ الجلب.
//
// وهذه الاختباراتُ تُثبّت القاعدةَ الواحدة: **أرقامُ المخزَّن بالـUTC هي أرقامُ ساعة بغداد
// كما يعرضها الساس** — عرضاً بـ`getUTC*`، وحساباً بطرح ٣ ساعات.
const p = (f: string) => path.join(process.cwd(), f);
const read = (f: string) => fs.readFileSync(p(f), "utf8");

describe("⏰ العرضُ يطابق لوحةَ الساس حرفيّاً", () => {
  test("قيمةٌ مقيسةٌ من الإنتاج: bg-47-1-2@shu — الساس يعرض 2026-09-17 17:00:00", () => {
    assert.equal(formatExpiry("2026-09-17T17:00:00.000Z"), "17/09/2026 17:00");
  });

  test("🔴 الحالةُ التي كانت تُظهر **يوماً زائداً**: انتهاءٌ بعد التاسعة مساءً", () => {
    // الساس يعرض `2025-01-15 21:23:02`، وكان البرنامجُ يعرضه 16/01/2025 (توقيتُ بغداد +٣)
    assert.equal(formatExpiry("2025-01-15T21:23:02.000Z"), "15/01/2025 21:23");
  });

  test("الغيابُ «—» في الشاشات، و**فراغٌ** في الرسائل (كما كان قبل الساعة)", () => {
    assert.equal(formatExpiry(null), "—");
    assert.equal(formatExpiryOrEmpty(null), "");
    assert.equal(formatExpiryOrEmpty(undefined), "");
  });

  test("لا يتأثّر بتوقيت الجهاز — يقرأ بالـUTC لا بالمحلّي", () => {
    const d = new Date(Date.UTC(2026, 7, 28, 17, 0, 0));
    assert.equal(formatExpiry(d), "28/08/2026 17:00");
  });
});

describe("🧮 اللحظةُ الحقيقيّةُ = المخزَّن − ٣ ساعات", () => {
  test("الساسُ بتوقيت بغداد (قِيس من System Log)", () => {
    const inst = expiryInstant("2026-09-17T17:00:00.000Z");
    assert.equal(inst?.toISOString(), "2026-09-17T14:00:00.000Z");
  });
});

describe("⌛ «المتبقي» دائماً يومٌ وساعةٌ ودقيقة", () => {
  const exp = "2026-09-17T17:00:00.000Z"; // = 14:00Z حقيقةً
  test("الصيغةُ ثلاثيّةٌ دائماً ولو كان الباقي ساعاتٍ فقط", () => {
    const now = new Date("2026-09-17T10:30:00.000Z"); // قبله بـ٣ س ٣٠ د
    assert.equal(remainingText(exp, now), "0 ي 3 س 30 د");
  });

  test("أيّامٌ وساعاتٌ ودقائق", () => {
    const now = new Date("2026-09-12T10:40:00.000Z");
    assert.equal(remainingText(exp, now), "5 ي 3 س 20 د");
  });

  test("المنتهي بإشارةِ سالبٍ لا بصفر", () => {
    const now = new Date("2026-09-18T14:00:00.000Z"); // بعده بيومٍ كامل
    assert.equal(remainingText(exp, now), "−1 ي 0 س 0 د");
    assert.equal(remaining(exp, now)?.negative, true);
  });

  test("بلا تاريخٍ ⇒ «—» لا صفر", () => {
    assert.equal(remainingText(null), "—");
    assert.equal(remaining(null), null);
  });

  test("📅 الفرقُ عن الحساب القديم: كان يقارن منتصفَ ليلٍ بمنتصف ليل", () => {
    // انتهاءٌ اليومَ الساعةَ ١٧:٠٠ والآن ٢٣:٣٤ من أمسِه ⇒ الحقيقةُ ١٧ ساعةً لا «يوماً»
    const now = new Date("2026-09-16T20:34:00.000Z"); // 23:34 بغداد
    const r = remaining("2026-09-17T17:00:00.000Z", now)!;
    assert.equal(r.days, 0);
    assert.equal(r.hours, 17);
  });
});

describe("🏦 ما يكتبه البرنامجُ لا الساس يبقى لحظةً حقيقيّة", () => {
  test("انتهاءُ القرض الافتراضيُّ يُعرَض بتوقيت بغداد صراحةً (الخادمُ UTC)", () => {
    // ٢٠:٣٤ UTC = ٢٣:٣٤ بغداد — ولو استُعملت `formatDateTime` على الخادم لظهرت ٢٠:٣٤
    assert.equal(formatBaghdadDateTime("2026-08-21T20:34:00.000Z"), "21/08/2026 23:34");
  });

  test("رسالةُ القرض تستعمل صيغةَ بغداد لا صيغةَ الساس", () => {
    const src = read("src/lib/loanMessage.ts");
    assert.ok(src.includes("formatBaghdadDateTime(opts.expiryVirtual)"), "رسالةُ القرض لا تُظهر الساعة");
    assert.ok(!src.includes("formatExpiry"), "طُبّقت إزاحةُ الساس على تاريخٍ يحسبه البرنامج");
  });

  test("«قروضٌ وديون» تُبقي انتهاءَ القرض على `formatDate` — لا إزاحةَ ساس عليه", () => {
    const src = read("src/app/(app)/loan-debts/page.tsx");
    assert.ok(src.includes("formatDate(r.expiryVirtual)"), "أُزيح تاريخٌ يحسبه البرنامج");
  });
});

describe("📨 كلُّ رسالةٍ تحمل اليومَ والساعةَ والدقيقة", () => {
  const senders: [string, string][] = [
    ["src/lib/scheduler.ts", "تذكيرُ الانتهاء والتذكيرُ حسب الباقة والمنتهي"],
    ["src/app/api/messages/route.ts", "الإرسالُ اليدويُّ والجماعيّ"],
    ["src/app/api/subscribers/[id]/summary/route.ts", "ملخّصُ المشترك"],
    ["src/app/api/subscribers/[id]/activate/route.ts", "رسالةُ التفعيل"],
    ["src/lib/selfActivatedNotice.ts", "إشعارُ التفعيل الذاتيّ"],
  ];
  for (const [file, what] of senders) {
    test(`${what} — ${file}`, () => {
      const src = read(file);
      assert.ok(src.includes("formatExpiryOrEmpty"), "لا يزال يُرسل التاريخَ بلا ساعة");
      assert.ok(!/\bformatDate\(/.test(src), "بقيت صيغةٌ قديمةٌ تسقط منها الساعة");
    });
  }
});

describe("🖥️ الشاشاتُ التي تعرض الانتهاء", () => {
  const screens: [string, string][] = [
    ["src/components/SubscribersBoard.tsx", "شريطُ المشترك وسجلُّ وصولاته"],
    ["src/app/(app)/all-subscribers/page.tsx", "كلُّ المشتركين"],
    ["src/app/(app)/reports/overall/page.tsx", "التقريرُ العامّ"],
    ["src/components/SyncLogModal.tsx", "سجلُّ المزامنة"],
    ["src/lib/printReceiptHtml.ts", "الوصلُ المطبوع"],
    ["src/app/(app)/subscriptions/[id]/receipt/page.tsx", "صفحةُ الوصل"],
  ];
  for (const [file, what] of screens) {
    test(`${what} — ${file}`, () => {
      assert.ok(read(file).includes("formatExpiry"), "ما زال يعرض الانتهاءَ بلا ساعة");
    });
  }

  test("شريطُ المشترك: «المتبقي» بصيغته الثلاثيّة والعناوينُ مختصَرة", () => {
    const src = read("src/components/SubscribersBoard.tsx");
    assert.ok(src.includes("remainingText(s.dateTo)"), "المتبقي ما زال أيّاماً صحيحة");
    assert.ok(!src.includes("الأيام المتبقية <b>"), "العنوانُ الطويلُ ما زال في الشريط");
    assert.ok(!src.includes("كود المكافأة <b>"), "«كود المكافأة» لم يُختصر");
    assert.ok(!src.includes("مبلغ الاشتراك <b>"), "«مبلغ الاشتراك» لم يُختصر");
    assert.ok(src.includes(">المتبقي <b>") && src.includes(">مكافأة <b>") && src.includes(">المبلغ <b>"), "العناوينُ المختصرةُ غائبة");
  });

  test("🎯 تصغيرُ الشريط: الفراغُ الجانبيُّ لزرَّي «تفعيل» و«قرض» قلّ", () => {
    const css = read("src/app/globals.css");
    assert.ok(!css.includes("padding: 5px 26px"), "زرُّ التفعيل ما زال بفراغه القديم");
    assert.ok(!css.includes("padding: 5px 18px;"), "زرُّ القرض ما زال بفراغه القديم");
    assert.ok(/\.sb-act\.go[\s\S]{0,200}padding: 5px 11px/.test(css), "لم يُضبط فراغُ زرّ التفعيل");
    assert.ok(/\.sb-act\.loan[\s\S]{0,200}padding: 5px 10px/.test(css), "لم يُضبط فراغُ زرّ القرض");
  });
});

describe("🔒 لا تُمَسّ القاعدةُ ولا طريقةُ الجلب (قرارُ محمد)", () => {
  test("المزامنةُ تحفظ ما يعطيه الساسُ كما هو — بلا إزاحةٍ عند الكتابة", () => {
    const src = read("src/lib/subscriptionSync.ts");
    assert.ok(src.includes("const sasDate = u.expiration ? new Date(u.expiration) : null;"), "تغيّرت طريقةُ الجلب");
    assert.ok(!src.includes("expiryInstant("), "أُقحمت إزاحةٌ في مسار الكتابة");
  });

  test("التفعيلُ يحفظ انتهاءَ الساس كما هو", () => {
    const src = read("src/app/api/subscribers/[id]/activate/route.ts");
    assert.ok(src.includes("const d = new Date(info.expiration);"), "تغيّرت طريقةُ الجلب في التفعيل");
  });
});
