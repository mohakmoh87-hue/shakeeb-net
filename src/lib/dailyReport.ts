import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { notMaster, onlyMaster, otherIncomeOnly } from "@/lib/moneyKinds";

// حدود يوم العراق (UTC+3)
export function iraqTodayRange(now = new Date()): { start: Date; end: Date } {
  const iraq = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = iraq.getUTCFullYear();
  const m = iraq.getUTCMonth();
  const d = iraq.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0) - 3 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - 3 * 60 * 60 * 1000);
  return { start, end };
}

// حدود "أمس" بتوقيت العراق (UTC+3) — لمرحلة مزامنة كروت وتفعيلات اليوم السابق
export function iraqYesterdayRange(now = new Date()): { start: Date; end: Date } {
  return iraqTodayRange(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");

// ===== تقارير المستخدمين في المكاتب متعدّدة المستخدمين (طلب محمد 2026-08-08) =====
// مكتبٌ فيه مستخدمان+ ⇒ كلّ مستخدمٍ يرى تقريره اليومي وحده (يُجبَر فلتر userId على جلسته).
// مكتبٌ بمستخدمٍ واحد ⇒ لا يتغيّر شيء (undefined = بلا فلتر). المدير لا يُجبَر (يختار بنفسه).
export async function reportUserScope(session: { isAdmin?: boolean; userId: number; towerId: number | null }): Promise<number | undefined> {
  if (session.isAdmin || session.towerId == null) return undefined;
  // ═════ البند ١ · الفصلُ بالمربّع لا بعددِ المستخدمين (طلبُ محمد 2026-08-13) ═════
  // كان: «مكتبٌ فيه مستخدمان ⇒ كلٌّ يرى نفسَه» — فصلٌ **إجباريٌّ بلا خيار**. وطلبُ محمد
  // أن يكون اختياريّاً: «وإن لم أضع صحّاً على المربّع فالاثنان يفعلان بنفس التقرير».
  //
  // ═════ 🔴 والفصلُ حكمٌ على **المكتب** لا على الفرد (بلاغا محمد 2026-08-26) ═════
  // حالةُ كاسبر الحيّة: فادي ورامي مؤشَّران وأبو فهد لا (أُنشئ أوّلاً قبل وجود زملاء —
  // والمربّعُ لا يُعرَض إلّا بوجود زميلٍ سابق) ⇒ **حالةٌ مختلطةٌ** جعلت أبا فهد يرى
  // مالَ فادي ورامي كلَّه، وأسقطته من تبويبات المدير معاً. فصار الحكم: مكتبٌ فيه
  // مستخدمان+ **وأيٌّ منهم مفصول ⇒ المكتبُ كلُّه منفصل** — الجميعُ يُجبَرون على
  // تقاريرهم والجميعُ يظهرون للمدير. ومكتبٌ بلا مؤشَّرٍ واحدٍ لا يتغيّر فيه شيء.
  return (await officeSeparated(session.towerId)) ? session.userId : undefined;
}

/** أهذا المكتبُ منفصلُ الحسابات؟ — مستخدمان+ وفيهم مؤشَّرٌ واحدٌ على الأقلّ */
export async function officeSeparated(towerId: number): Promise<boolean> {
  const us = await prisma.user.findMany({
    where: { towerId, isDeleted: false, isActive: true, isOwner: false },
    select: { separateAccount: true },
  });
  return us.length >= 2 && us.some((u) => u.separateAccount);
}

// يحسب أرقام التقرير اليومي (اختيارياً مقيّداً بمكتب واحد أو مجموعة مكاتب وكيل، وليوم محدّد للتدارك،
// وبمستخدمٍ محدّد userId — لتقارير المكاتب متعدّدة المستخدمين)
export async function computeDailyReport(
  towerId?: number | number[] | null, day?: Date, userId?: number,
  // ═════ ج · مدى «بين تاريخين» (طلبُ محمد 2026-08-26) ═════
  // «كم قبض مصطفى هذا الشهرَ كلَّه؟» كان بلا جوابٍ إلّا بفتح ثلاثين يوماً واحداً واحداً.
  // `endDay` يمدّ نهايةَ النافذة إلى آخرِ يومِه البغداديّ — والبدايةُ من `day` كما هي،
  // فكلُّ ناديها القدامى (بلا endDay) يعملون حرفيّاً كما كانوا.
  endDay?: Date,
) {
  const { start, end: sameDayEnd } = iraqTodayRange(day ?? new Date());
  const end = endDay ? iraqTodayRange(endDay).end : sameDayEnd;
  // 🔒 مدىً مقلوبٌ (نهايتُه قبل بدايته) يرتدّ يوماً واحداً — لا نافذةً فارغةً تُعرَض أصفاراً مضلِّلة
  const dateWhere = { date: { gte: start, lte: end < start ? sameDayEnd : end } };
  const towerWhere =
    towerId == null ? {} : Array.isArray(towerId) ? { towerId: { in: towerId.length ? towerId : [-1] } } : { towerId };
  // فلتر المستخدم: يمسّ كلّ الجداول الثلاثة (subscription_entries/money_tx/invoices تحمل userId)
  const userWhere = userId != null ? { userId } : {};

  const [activations, todayMoney, todayInvoices, todaySales, todayMaster, todayOther] = await Promise.all([
    // تفعيلات عادية فقط (ماستر مستقل)
    prisma.subscriptionEntry.aggregate({
      where: { isDeleted: false, isMaster: false, ...dateWhere, ...towerWhere, ...userWhere },
      _count: true,
      _sum: { moneyIn: true },
    }),
    // حركات الصندوق العادية — باستثناء الماستر (حساب مستقل لا يُجمع مع التقرير)
    prisma.moneyTx.aggregate({
      where: { isDeleted: false, ...dateWhere, ...towerWhere, ...userWhere, ...notMaster },
      _sum: { moneyIn: true, moneyOut: true },
    }),
    prisma.invoice.aggregate({
      // فواتير الماستر (type="ماستر") مستبعدة — مالها بحساب الماستر المستقل لا بالتقرير.
      // الجزء النقدي من فاتورة ماستر مختلطة يدخل المجموع عبر الصندوق ويظهر ضمن «أخرى».
      where: { isDeleted: false, NOT: { type: "ماستر" }, ...dateWhere, ...towerWhere, ...userWhere },
      _count: true,
      _sum: { waselHim: true },
    }),
    // مبيعات المخزن (البيع المباشر + مواد الذمم) — حركات سطرها sourceType="sale"
    prisma.moneyTx.aggregate({
      where: { isDeleted: false, sourceType: "sale", ...dateWhere, ...towerWhere, ...userWhere },
      _sum: { moneyIn: true },
    }),
    // حساب الماستر — مستقل تماماً، يظهر بسطر منفصل ولا يدخل بالمجموع
    prisma.moneyTx.aggregate({
      where: { isDeleted: false, ...onlyMaster, ...dateWhere, ...towerWhere, ...userWhere },
      _sum: { moneyIn: true, moneyOut: true },
    }),
    // «المقبوضات (اليوم)»: **مجموع صريح** لما ليس تفعيلاً ولا فاتورة ولا بيع مخزن ولا
    // ماستر (تسديدات ديون + حركات يدوية). كان طرحاً بين ثلاثة جداول مقصوصاً عند الصفر
    // فيبتلع مقبوضات حقيقية ولا يمكن سرد مكوّناته إطلاقاً (تدقيق 2026-08-04).
    prisma.moneyTx.aggregate({
      where: {
        isDeleted: false, ...dateWhere, ...towerWhere, ...userWhere,
        ...otherIncomeOnly, // يحمل moneyIn > 0 والاستثناءات معاً — من المصدر الموحّد
      },
      _sum: { moneyIn: true },
    }),
  ]);

  const todayIn = todayMoney._sum.moneyIn ?? 0;
  const todayOut = todayMoney._sum.moneyOut ?? 0;
  const activationIn = activations._sum.moneyIn ?? 0;
  const invoiceIn = todayInvoices._sum.waselHim ?? 0;
  const salesIn = todaySales._sum.moneyIn ?? 0;
  const masterIn = (todayMaster._sum.moneyIn ?? 0) - (todayMaster._sum.moneyOut ?? 0);
  const otherIn = todayOther._sum.moneyIn ?? 0;
  const total = todayIn - todayOut; // لا يشمل الماستر

  // ===== أ-٢٣ · تفصيلُ التفعيلات على لوحات الساس (طلب محمد 2026-08-13) =====
  // «في التقرير اليوميّ يظهر له كم مشتركاً مُفعَّلاً من ساس ١ وكم من ساس ٢، وأيضاً في صفحة
  // المدير عند عرض التقارير القديمة يظهر نفسُه».
  // 🔑 وهذا بعينه ما أُبقي مفتوحاً حين اختار محمد **تقريراً واحداً**: الفصلُ ممكنٌ مجّاناً
  //    للتفعيلات لأنّ المشتركَ يحمل لوحتَه — بخلاف المال الذي لا يُنسَب إلى مشتركٍ أصلاً.
  // 🔑 والتقاريرُ القديمةُ والحيّةُ تُحسَبان بهذه الدالّة نفسِها ⇒ تعديلٌ واحدٌ يظهر في الاثنَين.
  // ⚠️ ولا يُحسَب شيءٌ لمكتبٍ بلوحةٍ واحدة: الحقلُ يبقى فارغاً فلا تُظهره الواجهةُ لأحدٍ غيرِ
  //    أصحاب اللوحتَين ⇒ تقريرُ بقيّة الوكلاء كما هو حرفيّاً.
  let byPanel: { panelId: number; label: string; count: number }[] | undefined;
  try {
    const scopeTowers = await prisma.sasPanel.findMany({
      where: { isDeleted: false, ...(towerWhere as Prisma.SasPanelWhereInput) },
      select: { id: true, towerId: true, label: true, isPrimary: true, sortOrder: true },
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
    });
    // مكاتبُ النطاق التي لها أكثرُ من لوحةٍ حيّة وحدَها تُفصَّل
    const multi = new Map<number, typeof scopeTowers>();
    for (const p of scopeTowers) {
      const list = multi.get(p.towerId) ?? [];
      list.push(p);
      multi.set(p.towerId, list);
    }
    const panels = [...multi.values()].filter((l) => l.length > 1).flat();
    if (panels.length) {
      // تفعيلاتُ اليوم قليلةٌ (عشراتٌ) فجلبُ مشتركيها ثمّ عدُّهم بحسب لوحتهم أخفُّ وأوضحُ من
      // استعلامٍ خامٍ بضمٍّ — ولا يعتمد على علاقةٍ مُعلَنةٍ في المخطّط.
      const rows = await prisma.subscriptionEntry.findMany({
        where: { isDeleted: false, isMaster: false, ...dateWhere, ...towerWhere, ...userWhere },
        select: { subscriberId: true },
      });
      const subIds = [...new Set(rows.map((r) => r.subscriberId).filter((x): x is number => x != null))];
      const subs = subIds.length
        ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, sasPanelId: true } })
        : [];
      const panelOf = new Map(subs.map((s) => [s.id, s.sasPanelId]));
      const firstOf = new Map([...multi.entries()].map(([t, l]) => [t, l[0].id]));
      const counts = new Map<number, number>();
      for (const r of rows) {
        if (r.subscriberId == null) continue;
        // مشتركٌ بلا وسمٍ يُحسَب على لوحة مكتبه الأولى — وهي التي يُفعَّل عليها فعلاً بالسقوط
        const pid = panelOf.get(r.subscriberId) ?? null;
        const known = panels.find((p) => p.id === pid)?.id;
        const eff = known ?? [...firstOf.values()].find((x) => panels.some((p) => p.id === x));
        if (eff != null) counts.set(eff, (counts.get(eff) ?? 0) + 1);
      }
      byPanel = panels.map((p, i) => ({ panelId: p.id, label: p.label || `لوحة ${i + 1}`, count: counts.get(p.id) ?? 0 }));
    }
  } catch { /* التفصيلُ زينةٌ — لا يُفشل التقريرَ أبداً */ }

  return {
    activationCount: activations._count || 0,
    activationIn,
    invoiceCount: todayInvoices._count || 0,
    invoiceIn,
    salesIn,
    masterIn,
    otherIn,
    expenses: todayOut,
    total,
    ...(byPanel ? { activationsByPanel: byPanel } : {}),
  };
}

// نص التقرير اليومي لإرساله للمدير عبر واتساب (اختيارياً ليوم محدّد للتدارك)
export async function dailyReportText(office: string, towerId?: number | null, forDay?: Date): Promise<string> {
  const r = await computeDailyReport(towerId, forDay);
  // تاريخ اليوم بتوقيت بغداد (UTC+3) بنفس منطق حدود اليوم — لتفادي اختلاف المنطقة الزمنية المحلية
  const iraq = new Date((forDay ?? new Date()).getTime() + 3 * 60 * 60 * 1000);
  const day = `${String(iraq.getUTCDate()).padStart(2, "0")}/${String(iraq.getUTCMonth() + 1).padStart(2, "0")}/${iraq.getUTCFullYear()}`;
  return (
    `📊 التقرير اليومي — ${office}\n` +
    `التاريخ: ${day}\n` +
    `——————————————\n` +
    `تفعيل اشتراكات: ${r.activationCount} — ${fmt(r.activationIn)} د.ع\n` +
    `فاتورة المبيع: ${r.invoiceCount} — ${fmt(r.invoiceIn)} د.ع\n` +
    `مبيعات المخزن: ${fmt(r.salesIn)} د.ع\n` +
    `المقبوضات الأخرى: ${fmt(r.otherIn)} د.ع\n` +
    `المصروفات: ${fmt(r.expenses)} د.ع\n` +
    `——————————————\n` +
    `💰 المجموع: ${fmt(r.total)} د.ع\n` +
    `🅜 حساب الماستر (مستقل): ${fmt(r.masterIn)} د.ع`
  );
}
