import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { dailyReportText, computeDailyReport } from "@/lib/dailyReport";
import { messageDedupKey, alreadySentToday } from "@/lib/messageDedup"; // خاتمة الأصل ٢ (2026-08-19)
import { formatDate } from "@/lib/format";

// مجدول المهام: يعمل داخل عملية الخادم (توقيت العراق).
// يُسجَّل مرة واحدة عبر instrumentation.ts.

const g = globalThis as unknown as { __schedulerStarted?: boolean };

const TZ = "Asia/Baghdad";


// جلب قالب رسالة حسب التصنيف
// قالب المكتب المخصّص أولاً ثم قالب الوكيل العام (عزل المستأجر والمكتب)
// البند ٣ · تُرجع النصَّ **وصورتَه** معاً — فالصورةُ تصل مع أيّ قالبٍ يختاره محمد
async function getTemplate(type: string, agentId: number | null, towerId?: number | null): Promise<{ text: string; image: string | null } | null> {
  const { getEffectiveTemplateFull } = await import("@/lib/smsTemplates");
  return getEffectiveTemplateFull(type, agentId, towerId); // قالب المكتب ← الوكيل ← الافتراضي؛ null إن مُعطَّل
}

// تاريخ يوم معيّن بصيغة YYYY-MM-DD (توقيت بغداد)
function baghdadDateStr(d: Date): string {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function baghdadToday(): string { return baghdadDateStr(new Date()); }
function baghdadYesterday(): Date { return new Date(Date.now() - 24 * 60 * 60 * 1000); }

// ===== تذكير المشتركين المنتهين خلال «أيام التذكير» — لمكاتب محدّدة (أو الكل) =====
// عدد الأيام لكلّ مكتب (Tower.reminderDays) — فارغ = يومان (السلوك القديم). طلب محمد 2026-08-09.
export const DEFAULT_REMINDER_DAYS = 2;
export const reminderDaysOf = (d: number | null | undefined): number =>
  d != null && Number.isFinite(d) && d >= 1 ? Math.floor(d) : DEFAULT_REMINDER_DAYS;

export async function runExpiringReminder(
  officeIds?: number[],
  // ب-١/الأصل ٢ · `claimDay` للمسار **التلقائيّ** حصراً (المُجدول). راجع الشرحَ أدناه.
  opts?: { claimDay?: boolean },
): Promise<{ sent: number; failed: number }> {
  const now = new Date();

  // ═════ ب-١/الأصل ٢ · حَجزُ يومِ المكتب **قبل** الإرسال لا بعده (2026-08-13) ═════
  // 🔴 كان ختمُ `lastReminderDate` **بعد** حلقة الإرسال كلِّها (مئاتُ رسائل واتساب،
  //   دقائق). والمُجدولُ يُطلق على **تطابقِ الدقيقة** ولا يفحص الختمَ أصلاً ⇒ حاسبتان
  //   للوكيل نفسِه (أو لحظةُ انتقال القيادة) تُطلقان معاً، فيصل كلَّ مشترك **تذكيرانِ**.
  //   وهذه عينُ حادثةِ تكرار رسائل واتساب التي بلّغ عنها مكتبُ الشدن.
  // ⇒ يُحجَز يومُ كلّ مكتبٍ ذرّيّاً **قبل** أوّل رسالة، والخاسرُ يُسقط ذلك المكتبَ.
  // 🔑 والحجزُ للتلقائيّ وحدَه: `api/whatsapp/send-expiring` و`api/reminders/handle`
  //   طلبانِ صريحانِ من مستخدمٍ ضغط زرّاً — ومنعُهما لأنّ اليومَ مختومٌ يكون تعطيلاً
  //   لميزةٍ قائمةٍ لا إصلاحاً لعلّة.
  if (opts?.claimDay && officeIds?.length) {
    const todayK = baghdadToday();
    const won: number[] = [];
    for (const id of officeIds) {
      const c = await prisma.tower.updateMany({
        where: { id, OR: [{ lastReminderDate: null }, { lastReminderDate: { not: todayK } }] },
        data: { lastReminderDate: todayK },
      });
      if (c.count === 1) won.push(id);
    }
    if (!won.length) return { sent: 0, failed: 0 }; // كلُّها محجوزةٌ لغيرنا اليوم
    officeIds = won;
  }
  // المكاتب أوّلاً: منها نعرف أيام كلّ مكتب — نستعلم بأوسع نافذة ثم نُرشّح كلّ مشترك بأيام مكتبه
  const offices = await prisma.tower.findMany({ select: { id: true, name: true, waEnabled: true, agentId: true, reminderDays: true } });
  const officeMap = new Map(offices.map((o) => [o.id, o]));
  const involved = officeIds ? offices.filter((o) => officeIds.includes(o.id)) : offices;
  const maxDays = involved.length ? Math.max(...involved.map((o) => reminderDaysOf(o.reminderDays))) : DEFAULT_REMINDER_DAYS;
  const maxLimit = new Date();
  maxLimit.setDate(maxLimit.getDate() + maxDays);
  // حدّ كلّ مكتب (نهاية يوم الحدّ) — يُحسب مرّة لكلّ مكتب
  const officeLimit = new Map<number, number>();
  for (const o of involved) {
    const l = new Date();
    l.setDate(l.getDate() + reminderDaysOf(o.reminderDays));
    officeLimit.set(o.id, l.getTime());
  }

  const recipients = await prisma.subscriber.findMany({
    where: {
      isDeleted: false,
      waEnabled: true,
      dateTo: { not: null, gte: now, lte: maxLimit },
      ...(officeIds ? { towerId: { in: officeIds } } : {}),
    },
  });
  const packages = await prisma.package.findMany({ select: { id: true, name: true, priceDinar: true } });
  const priceMap = new Map(packages.map((p) => [p.id, p.priceDinar ?? 0]));
  const pkgNameMap = new Map(packages.map((p) => [p.id, p.name]));
  // اسم النظام الافتراضي لكل وكيل (معزول) — يُقرأ بحسب وكيل مكتب كل مستلم مع تخزين مؤقت
  const { getAgentSetting } = await import("@/lib/agentSettings");
  const fallbackCache = new Map<number | null, string>();
  const fallbackOfficeFor = async (aid: number | null): Promise<string> => {
    if (!fallbackCache.has(aid)) fallbackCache.set(aid, await getAgentSetting("office", aid, "SHAKEEB"));
    return fallbackCache.get(aid)!;
  };
  // قالب "expiring" لكل (وكيل، مكتب) — يُجلب مرّة ويُخزَّن؛ قالب المكتب يغلب قالب الوكيل
  const tplCache = new Map<string, { text: string; image: string | null } | null>();
  async function templateFor(agentId: number | null, towerId: number | null): Promise<{ text: string; image: string | null } | null> {
    if (agentId == null) return null;
    const key = `${agentId}:${towerId ?? 0}`;
    if (!tplCache.has(key)) tplCache.set(key, await getTemplate("expiring", agentId, towerId));
    return tplCache.get(key) ?? null;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let sent = 0, failed = 0, i = 0;
  for (const sub of recipients) {
    const office = sub.towerId ? officeMap.get(sub.towerId) : null;
    if (office?.waEnabled === "0") continue; // مكتب معطّل الواتساب
    // ترشيح بأيام مكتب المشترك نفسه (النافذة أعلاه أوسع نافذةٍ بين المكاتب)
    const lim = sub.towerId != null ? officeLimit.get(sub.towerId) : undefined;
    if (lim != null && sub.dateTo && sub.dateTo.getTime() > lim) continue;
    const template = await templateFor(office?.agentId ?? null, sub.towerId ?? null);
    if (!template) continue; // لا قالب مفعّل لوكيل هذا المكتب
    if (i++ > 0) await sleep(10000); // تأخير 10 ثوانٍ بين رسالة وأخرى
    const text = renderTemplate(template.text, {
      name: sub.name,
      netUser: sub.netUser,
      address: sub.address, // «ادرس 1» من الساس — يظهر فقط إن أدخله المدير في القالب
      package: sub.packageId ? pkgNameMap.get(sub.packageId) ?? "" : "",
      phone: sub.phone,
      dateTo: sub.dateTo ? formatDate(sub.dateTo) : "",
      carry: sub.carry ?? 0,
      remaining: sub.carry ?? 0,
      price: sub.packageId ? priceMap.get(sub.packageId) ?? 0 : 0,
      code: sub.rewardCode, balance: sub.rewardBalance ?? 0, // كود/رصيد الخصم (فارغ لمن لا رصيد له)
      office: office?.name ?? (await fallbackOfficeFor(office?.agentId ?? null)),
    });
    // ═════ خاتمةُ الأصل ٢ (2026-08-19) · تذكيرُ الانتهاء تحت مظلّة فهرس التكرار ═════
    // claimDay يحرس **المكتبَ** من دورتَي مُجدولٍ — لكنّ الزرَّ اليدويَّ (send-expiring)
    // يتعمّد تجاوزَه، فمُجدولٌ ثمّ زرٌّ (أو ضغطتان) = رسالتان لنفس المشترك. الحارسُ
    // الفرديُّ يسدّها: فحصٌ قبل الإرسال + dedupKey على السجلّ (الفهرسُ الفريدُ شبكةُ أمان).
    if (await alreadySentToday(sub.id, "expiring", office?.agentId ?? null)) continue;
    const res = await sendViaProvider("WHATSAPP", sub.phone, text, sub.towerId, template.image); // واتساب مكتب المشترك + صورةُ القالب
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
        createdByUser: "scheduler",
        agentId: office?.agentId ?? null, // عزل سجلّ الرسائل بالوكيل
        templateType: "expiring",
        dedupKey: messageDedupKey(office?.agentId ?? null, sub.id, "expiring"),
      },
    }).catch(() => { /* اصطدامُ الفهرس (سباقٌ نادرٌ عبر عمليّتَين) = سُجّلت اليومَ سلفاً */ });
    res.ok ? sent++ : failed++;
  }

  // ختم "عولج اليوم" على المكاتب المعنيّة (لمنع تكرار طلب الموافقة عند الدخول)
  const today = baghdadToday();
  if (officeIds && officeIds.length) {
    await prisma.tower.updateMany({ where: { id: { in: officeIds } }, data: { lastReminderDate: today } });
  }
  return { sent, failed };
}

// ===== رسائل الديون اليومية — لمكاتب فعّلت «إرسال رسائل يومية للديون» (طلب محمد) =====
// تُرسَل لكلّ مشترك عليه دين (carry > 0) في المكاتب المعنيّة، بقالب "debts" (مطالبة بالديون).
// عزل صارم: مقيَّدة بالمكاتب المُمرَّرة (مكاتب وكيل هذا العامل حصراً — يُحدَّد في الكرون).
export async function runDebtReminder(
  officeIds: number[],
  opts?: { claimDay?: boolean }, // ب-١/الأصل ٢ — للمُجدول حصراً (اليدويُّ طلبٌ صريح)
): Promise<{ sent: number; failed: number }> {
  if (!officeIds.length) return { sent: 0, failed: 0 };
  // حَجزُ يومِ كلّ مكتبٍ **قبل** أوّل رسالة. ورسائلُ الديون كانت **بلا ختمٍ إطلاقاً**،
  // والمُجدولُ يُطلقها على تطابقِ الدقيقة ⇒ حاسبتان تُرسلان لكلّ مَدينٍ مرّتَين.
  if (opts?.claimDay) {
    const todayK = baghdadToday();
    const won: number[] = [];
    for (const id of officeIds) {
      const c = await prisma.tower.updateMany({
        where: { id, OR: [{ lastDebtReminderDate: null }, { lastDebtReminderDate: { not: todayK } }] },
        data: { lastDebtReminderDate: todayK },
      });
      if (c.count === 1) won.push(id);
    }
    if (!won.length) return { sent: 0, failed: 0 };
    officeIds = won;
  }
  const recipients = await prisma.subscriber.findMany({
    where: { isDeleted: false, waEnabled: true, carry: { gt: 0 }, towerId: { in: officeIds } },
  });
  if (!recipients.length) return { sent: 0, failed: 0 };
  const packages = await prisma.package.findMany({ select: { id: true, name: true, priceDinar: true } });
  const priceMap = new Map(packages.map((p) => [p.id, p.priceDinar ?? 0]));
  const pkgNameMap = new Map(packages.map((p) => [p.id, p.name]));
  const offices = await prisma.tower.findMany({ select: { id: true, name: true, waEnabled: true, agentId: true } });
  const officeMap = new Map(offices.map((o) => [o.id, o]));
  const { getAgentSetting } = await import("@/lib/agentSettings");
  const fallbackCache = new Map<number | null, string>();
  const fallbackOfficeFor = async (aid: number | null): Promise<string> => {
    if (!fallbackCache.has(aid)) fallbackCache.set(aid, await getAgentSetting("office", aid, "SHAKEEB"));
    return fallbackCache.get(aid)!;
  };
  const tplCache = new Map<string, { text: string; image: string | null } | null>();
  async function templateFor(agentId: number | null, towerId: number | null): Promise<{ text: string; image: string | null } | null> {
    if (agentId == null) return null;
    const key = `${agentId}:${towerId ?? 0}`;
    if (!tplCache.has(key)) tplCache.set(key, await getTemplate("debts", agentId, towerId));
    return tplCache.get(key) ?? null;
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let sent = 0, failed = 0, i = 0;
  for (const sub of recipients) {
    const office = sub.towerId ? officeMap.get(sub.towerId) : null;
    if (office?.waEnabled === "0") continue;
    const template = await templateFor(office?.agentId ?? null, sub.towerId ?? null);
    if (!template) continue; // لا قالب "debts" مفعّل لوكيل هذا المكتب
    if (i++ > 0) await sleep(10000);
    const text = renderTemplate(template.text, {
      name: sub.name, netUser: sub.netUser,
      package: sub.packageId ? pkgNameMap.get(sub.packageId) ?? "" : "",
      phone: sub.phone, dateTo: sub.dateTo ? formatDate(sub.dateTo) : "",
      carry: sub.carry ?? 0, remaining: sub.carry ?? 0,
      price: sub.packageId ? priceMap.get(sub.packageId) ?? 0 : 0,
      code: sub.rewardCode, balance: sub.rewardBalance ?? 0,
      office: office?.name ?? (await fallbackOfficeFor(office?.agentId ?? null)),
    });
    // خاتمةُ الأصل ٢ · مطالبةُ ديونٍ واحدةٌ لكلّ مشتركٍ في اليوم — عبر كلّ المسارات
    // (المُجدولُ هنا + زرُّ صفحة الديون الذي يمرّ بـ/api/messages المحروسِ سلفاً).
    if (await alreadySentToday(sub.id, "debts", office?.agentId ?? null)) continue;
    const res = await sendViaProvider("WHATSAPP", sub.phone, text, sub.towerId, template.image);
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null, createdByUser: "scheduler",
        agentId: office?.agentId ?? null, // عزل سجلّ الرسائل بالوكيل
        templateType: "debts",
        dedupKey: messageDedupKey(office?.agentId ?? null, sub.id, "debts"),
      },
    }).catch(() => { /* اصطدامُ الفهرس = مطالبةُ اليوم سُجّلت سلفاً */ });
    res.ok ? sent++ : failed++;
  }
  return { sent, failed };
}

// ═════════════ البند ٤-أ · «المنتهون منذ N يوم» (طلبُ محمد 2026-08-13) ═════════════
//
// «أختار **بعد كم يومٍ** من الانتهاء تُرسَل ووقتَ الإرسال، وقالبٌ خاصٌّ بهم.»
// 🔑 **والشرطُ الجوهريّ**: مَن أُرسل له وهو «منتهٍ منذ يوم» **لا يُرسَل له غداً** وهو
//    منتهٍ منذ يومَين ⇒ فالإرسالُ لـ**الجدد في تلك الفئة** كلَّ يوم.
//
// وحرسان لا يُستغنى عن أحدهما:
//  ١. **ختمٌ لكلّ مشترك** (`expiredNoticeAt`) يُكتب **قبل الإرسال ذرّيّاً** — فحاسبتان
//     تعملان معاً لا تُرسلان مرّتَين (درسُ الشدن: ٤ نسخ). ويُزال عند التفعيل.
//  ٢. **ونافذةٌ عُلويّةٌ للانتهاء**: لا يُرسَل لمن انتهى قبل `N + GRACE` يوماً — فمشتركٌ
//     انتهى قبل ثلاثة أشهرَ لا يُفاجَأ برسالةٍ لأنّ ختمَه فارغ. وبلا هذه النافذة يكون
//     **أوّلُ تشغيلٍ رشقةً لكلّ منتهٍ في القاعدة** (وهي عينُ ما نحرس منه).
const EXPIRED_NOTICE_GRACE_DAYS = 7;

export async function runExpiredNotice(
  officeIds: number[],
  opts?: { claimDay?: boolean },
): Promise<{ sent: number; failed: number; stamped: number }> {
  if (!officeIds.length) return { sent: 0, failed: 0, stamped: 0 };

  // حَجزُ يومِ كلّ مكتبٍ قبل أوّل رسالة (نفسُ حرسِ تذكير الانتهاء ورسائل الديون)
  if (opts?.claimDay) {
    const todayK = baghdadToday();
    const won: number[] = [];
    for (const id of officeIds) {
      const c = await prisma.tower.updateMany({
        where: { id, OR: [{ lastExpiredNoticeDate: null }, { lastExpiredNoticeDate: { not: todayK } }] },
        data: { lastExpiredNoticeDate: todayK },
      });
      if (c.count === 1) won.push(id);
    }
    if (!won.length) return { sent: 0, failed: 0, stamped: 0 };
    officeIds = won;
  }

  const offices = await prisma.tower.findMany({
    where: { id: { in: officeIds } },
    select: { id: true, name: true, agentId: true, waEnabled: true, expiredNoticeDays: true },
  });
  // (بلا خريطةِ مكاتب: المرورُ على `offices` مباشرةً — فكلُّ مكتبٍ يُعالَج بأيّامه)

  // اسمُ النظام الافتراضيُّ لكلّ وكيل (معزول) — لمكتبٍ بلا اسم
  const { getAgentSetting } = await import("@/lib/agentSettings");
  const fallbackCache = new Map<number | null, string>();
  const fallbackOfficeFor = async (aid: number | null): Promise<string> => {
    if (!fallbackCache.has(aid)) fallbackCache.set(aid, await getAgentSetting("office", aid, "SHAKEEB"));
    return fallbackCache.get(aid)!;
  };

  const now = Date.now();
  const dayMs = 86400_000;
  let sent = 0, failed = 0, stamped = 0, i = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 🔑 ويُعالَج **كلُّ مكتبٍ بأيّامه**: مكتبٌ يختار يوماً وآخرُ ثلاثةً، فنافذةُ كلٍّ
  //   تُحسَب بأيّامه لا بأيّام غيره — ولو جُمعوا في استعلامٍ واحدٍ لَغلبت أيّامُ الأوّل.
  for (const office of offices) {
    if (office.waEnabled === "0") continue;
    const days = Math.max(1, office.expiredNoticeDays ?? 1);
    // منتهٍ منذ `days` يوماً على الأقلّ، وليس أقدمَ من `days + GRACE`
    const upper = new Date(now - days * dayMs);                                  // dateTo <= هذا
    const lower = new Date(now - (days + EXPIRED_NOTICE_GRACE_DAYS) * dayMs);    // dateTo >= هذا
    const subs = await prisma.subscriber.findMany({
      where: {
        isDeleted: false, waEnabled: true, towerId: office.id,
        expiredNoticeAt: null, // لم يُبلَّغ عن هذا الانتهاء بعد
        dateTo: { lte: upper, gte: lower },
      },
      select: {
        id: true, name: true, netUser: true, phone: true, packageId: true,
        carry: true, dateTo: true, towerId: true, rewardCode: true, rewardBalance: true,
      },
    });
    if (!subs.length) continue;

    const tpl = await getTemplate("expiredSince", office.agentId, office.id);
    if (!tpl) continue; // القالبُ مُعطَّلٌ لهذا المكتب/الوكيل ⇒ لا إرسالَ ولا ختم
    const pkgIds = [...new Set(subs.map((s) => s.packageId).filter((x): x is number => x != null))];
    const pkgs = pkgIds.length
      ? await prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true, priceDinar: true } })
      : [];
    const pkgName = new Map(pkgs.map((p) => [p.id, p.name ?? ""]));
    const pkgPrice = new Map(pkgs.map((p) => [p.id, p.priceDinar ?? 0]));
    const officeName = office.name ?? (await fallbackOfficeFor(office.agentId));

    for (const sub of subs) {
      // ═══ الحَجزُ قبل الأثر: الختمُ أوّلاً، وبشرطِ أنّه ما زال فارغاً ═══
      // فمَن خسر السباقَ يجد `count === 0` فيتخطّى — ولا تُرسَل نسخةٌ ثانية.
      const claim = await prisma.subscriber.updateMany({
        where: { id: sub.id, expiredNoticeAt: null },
        data: { expiredNoticeAt: new Date() },
      });
      if (claim.count !== 1) continue;
      stamped++;
      if (i++ > 0) await sleep(10000); // تأخيرٌ بين رسالةٍ وأخرى (حمايةُ الرقم من الحظر)
      const text = renderTemplate(tpl.text, {
        name: sub.name, netUser: sub.netUser,
        package: sub.packageId ? pkgName.get(sub.packageId) ?? "" : "",
        phone: sub.phone, dateTo: sub.dateTo ? formatDate(sub.dateTo) : "",
        carry: sub.carry ?? 0, remaining: sub.carry ?? 0,
        price: sub.packageId ? pkgPrice.get(sub.packageId) ?? 0 : 0,
        code: sub.rewardCode, balance: sub.rewardBalance ?? 0,
        office: officeName,
      });
      const res = await sendViaProvider("WHATSAPP", sub.phone, text, sub.towerId, tpl.image);
      await prisma.message.create({
        data: {
          channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
          status: res.ok ? "SENT" : "FAILED", error: res.error ?? null, createdByUser: "scheduler",
          agentId: office.agentId ?? null, // عزل سجلّ الرسائل بالوكيل
        },
      });
      // ⚠️ والختمُ **يبقى** ولو فشل الإرسال: إعادةُ المحاولة كلَّ يومٍ تعني رسالةً
      //   يوميّةً لمن لا يعمل واتسابُه ثمّ رشقةً حين يعمل — وهو ضدُّ «مرّةً واحدة».
      //   والفشلُ مسجَّلٌ في `messages` فيُرى في سجلّ الرسائل.
      if (res.ok) sent++; else failed++;
    }
  }
  return { sent, failed, stamped };
}

// ===== التقرير اليومي لمدير كل مكتب من واتساب مكتبه (صامت) =====
// officeIds: مكاتب محدّدة (مثلاً مكتب المستخدم عند تسجيل الخروج)، أو كلها إن أُهملت.
// oncePerDay: يُرسل مرة واحدة فقط في اليوم لكل مكتب (يعتمد lastReportDate) — لمنع التكرار
//             عند تعدّد مرات تسجيل الخروج أو تداخل الاحتياطي المجدول.
export async function runManagerDailyReport(
  officeIds?: number[],
  opts: { oncePerDay?: boolean; day?: Date; skipIfEmpty?: boolean } = {},
): Promise<{ sent: number; failed: number }> {
  const targetDay = opts.day ?? new Date();
  const dayStr = baghdadDateStr(targetDay);
  const offices = await prisma.tower.findMany({
    where: {
      isDeleted: false,
      managerPhone: { not: null },
      ...(officeIds ? { id: { in: officeIds } } : {}),
      ...(opts.oncePerDay ? { NOT: { lastReportDate: dayStr } } : {}),
    },
    select: { id: true, name: true, managerPhone: true, agentId: true }, // agentId لوسم الرسالة (عزل)
  });

  let sent = 0, failed = 0;
  for (const office of offices) {
    const phone = (office.managerPhone ?? "").trim();
    if (!phone) continue;
    // عند التدارك: لا نُرسل تقرير يوم بلا أي حركة (مكتب مغلق ذلك اليوم)
    if (opts.skipIfEmpty) {
      const r = await computeDailyReport(office.id, targetDay);
      if (r.activationCount === 0 && r.invoiceCount === 0 && r.total === 0) {
        await prisma.tower.update({ where: { id: office.id }, data: { lastReportDate: dayStr } });
        continue;
      }
    }
    let text = await dailyReportText(office.name ?? "المكتب", office.id, targetDay); // تقرير هذا المكتب لليوم المحدّد
    // ═════ رقابة(ب) 2026-08-19 · ملخّصُ أعطال اليوم يركب تقريرَ المدير القائم ═════
    // «رسالةٌ كلَّ صباح: كم خطأً وقع وأين» — بلا قناةِ إرسالٍ جديدة: يُلحَق بالتقرير
    // اليوميّ نفسِه فيرث عزلَه (وكيلُ المكتب حصراً) وقناتَه ومواعيدَه وختمَ تكراره.
    // 🔒 العزل: أخطاءُ الواجهة تُعَدّ لمستخدمي هذا الوكيل، والرسائلُ الفاشلة بـagentId،
    //    والمكاتبُ الساقطة من مكاتب الوكيل — لا شيءَ يعبر بين مستأجرَين.
    try {
      const agentId = office.agentId ?? -1;
      const dayStart = new Date(targetDay); dayStart.setTime(Date.parse(dayStr + "T00:00:00+03:00"));
      const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
      const agentUsers = await prisma.user.findMany({ where: { agentId }, select: { id: true } });
      const uids = agentUsers.map((u) => u.id);
      const [uiErrors, failedMsgs, agentTowers] = await Promise.all([
        uids.length ? prisma.auditLog.count({ where: { action: "CLIENT_ERROR", userId: { in: uids }, createdAt: { gte: dayStart, lt: dayEnd } } }) : 0,
        prisma.message.count({ where: { agentId, status: "FAILED", date: { gte: dayStart, lt: dayEnd } } }),
        prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true, name: true } }),
      ]);
      const sessions = await prisma.waSession.findMany({ where: { towerId: { in: agentTowers.map((t) => t.id) } }, select: { towerId: true, state: true, updatedAt: true } });
      const stale = 5 * 60_000;
      const downNames = agentTowers
        .filter((t) => { const ss = sessions.find((x) => x.towerId === t.id); return !ss || ss.state !== "ready" || Date.now() - ss.updatedAt.getTime() > stale; })
        .map((t) => t.name ?? `#${t.id}`);
      if (uiErrors > 0 || failedMsgs > 0 || downNames.length > 0) {
        text += `

🩺 ملخّصُ الأعطال:`;
        if (uiErrors > 0) text += `
· أخطاءُ شاشاتٍ اليوم: ${uiErrors} (تفاصيلُها في سجلّ التدقيق)`;
        if (failedMsgs > 0) text += `
· رسائلُ واتساب فشلت اليوم: ${failedMsgs} (سجلُّ الرسائل)`;
        if (downNames.length > 0) text += `
· مكاتبُ واتسابها غيرُ متصلٍ الآن: ${downNames.slice(0, 5).join("، ")}${downNames.length > 5 ? "…" : ""}`;
      }
    } catch (e) {
      console.error("[scheduler] تعذّر بناءُ ملخّص الأعطال — يُرسل التقريرُ بدونه:", e instanceof Error ? e.message : e);
    }
    const res = await sendViaProvider("WHATSAPP", phone, text, office.id); // من واتساب هذا المكتب
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
        createdByUser: "scheduler",
        agentId: office.agentId ?? null, // عزل: سجلّ الرسائل يُرشَّح بالوكيل لا باسم المُنشئ
      },
    });
    // ختم اليوم لمنع تكرار الإرسال (حتى لو فشل الإرسال نمنع محاولات متكرّرة مزعجة)
    await prisma.tower.update({ where: { id: office.id }, data: { lastReportDate: dayStr } });
    res.ok ? sent++ : failed++;
  }
  return { sent, failed };
}

// ===== تدارك تقرير الأمس عند تشغيل أي حاسبة (لمن نسي تسجيل الخروج وأطفأ الحاسبة) =====
// يُرسل تقرير الأمس صامتاً إن لم يكن أُرسل، ولا يُرسل ليوم بلا حركة.
export async function catchUpManagerReport(): Promise<{ sent: number; failed: number }> {
  return runManagerDailyReport(undefined, { oncePerDay: true, day: baghdadYesterday(), skipIfEmpty: true });
}

// ===== إلغاء الرسائل التي لم تُرسل — محاولة واحدة فقط، بلا إعادة إرسال إطلاقاً =====
// لماذا: «انتهت المهلة» لا تعني أنّ الرسالة لم تصل — واتساب قد يسلّمها ثم يتأخّر ردّ
// التأكيد. الإعادة كل دقيقة كانت تُوصل الرسالة نفسها للمشترك خمس مرّات وأكثر بينما
// السجلّ يظنّها لم تصل ولا مرّة. لذلك: كل رسالة تُحاوَل مرّة واحدة، وما لم يُرسَل يُلغى.
export async function cancelUnsentMessages(): Promise<{ cancelled: number }> {
  const res = await prisma.message.updateMany({
    // 🔴 `error: null` شرطٌ حاكم (حادثة 2026-08-14 18:45): كانت تُلغي كلَّ PENDING بلا
    //   استثناء — **فذبحت طابورَ البثّ الجديد** (١٧٦ رسالةً لمكتب الرسالة في أوّل دقيقةٍ
    //   بعد عودة الحاسبات). صفوفُ الطابور موسومةٌ في error («📤 في طابور البثّ» أو
    //   «⏳ قيد الإرسال») فتُستثنى — وتبقى المقصلةُ ليتامى النمط القديم (error فارغ) وحدَهم.
    where: { channel: "WHATSAPP", status: "PENDING", error: null },
    data: { status: "FAILED", error: "أُلغيت — محاولة واحدة فقط بلا إعادة إرسال" },
  });
  if (res.count) console.log(`[scheduler] أُلغيت ${res.count} رسالة لم تُرسل (بلا إعادة محاولة)`);
  return { cancelled: res.count };
}

// حذف نهائي لأرشيف الرسائل بعد ٣ أيام من إرسالها (تُحفظ ٣ أيام فقط لضمان وصولها)
export async function purgeOldMessages(days = 3): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const res = await prisma.message.deleteMany({ where: { date: { lt: cutoff } } });
  if (res.count) console.log(`[scheduler] حُذف ${res.count} رسالة أقدم من ${days} أيام`);
  return { deleted: res.count };
}

// حذف نهائي للمشتركين المحوّلين الذين مضى 30 يوماً على تحويلهم دون تفعيل
export async function purgeTransferredSubscribers(days = 30): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const subs = await prisma.subscriber.findMany({
    where: { isDeleted: false, transferredAt: { not: null, lt: cutoff } },
    select: { id: true },
  });
  if (!subs.length) return { deleted: 0 };
  const { purgeSubscribers } = await import("@/lib/subscriberDelete");
  const res = await purgeSubscribers(subs.map((s) => s.id));
  console.log(`[scheduler] حُذف ${res.deleted} مشترك محوّل مضى ${days} يوماً دون تفعيل`);
  return res;
}

// الوقت الحالي بتوقيت بغداد بصيغة HH:MM
function baghdadHHMM(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

// بدء جلسات واتساب لكل مكتب (للقائد فقط) — تُستدعى عند الإقلاع وعند تولّي القيادة (مرّة واحدة)
let officeWaStarted = false;
async function ensureOfficeWhatsApp() {
  if (officeWaStarted) return;
  officeWaStarted = true;
  try {
    const { startWhatsApp, hostsOfficeLocally } = await import("@/lib/whatsapp");
    const { getWorkerAgentId, getWorkerTowerId } = await import("@/lib/hybridAgent");
    const aid = getWorkerAgentId();
    if (aid == null) { officeWaStarted = false; return; } // بلا وكيل بعد (غير معتمَد) — لا تستضِف شيئاً
    // عزل واتساب صارم: حاسبة مربوطة بمكتب (towerId) ⇒ تستضيف جلسة مكتبها فقط لا غير.
    // غير المربوطة (توافق قديم): مكاتب وكيلها التي تملك جلستها على قرصها.
    const boundTower = getWorkerTowerId();
    const offices = (await prisma.tower.findMany({
      where: {
        isDeleted: false, agentId: aid,
        ...(boundTower != null ? { id: boundTower } : {}),
        OR: [{ NOT: { waEnabled: "0" } }, { managerPhone: { not: null } }],
      },
      select: { id: true },
      // الحاسبة المربوطة تبدأ مكتبها دائماً (تُظهر QR للربط إن لم تكن له ملفات بعد)؛
      // غير المربوطة تبدأ ما تملك جلسته على قرصها فقط (توافق قديم).
    })).filter((o) => boundTower != null || hostsOfficeLocally(o.id));
    if (offices.length) console.log(`[scheduler] بدء واتساب ${offices.length} مكتب (جلساتها على هذه الحاسبة)`);
    // إقلاع متتابع بفاصل زمني — تشغيل عدّة متصفّحات واتساب دفعةً واحدة يُزاحم موارد
    // الحاسبة فيعلق بعضها على "authenticated/starting". الفاصل يمنح كل مكتب فرصة الاستقرار.
    for (const o of offices) {
      try { await startWhatsApp(o.id); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 25000)); // 25ث بين مكتب وآخر
    }
  } catch (e) {
    officeWaStarted = false; // سماح بإعادة المحاولة لاحقاً
    console.error("[scheduler] office WA start:", e);
  }
}

export function startScheduler() {
  if (g.__schedulerStarted) return;
  g.__schedulerStarted = true;

  // نبضة كل دقيقة: تقارن الوقت الحالي (بغداد) بالأوقات المضبوطة من إعدادات المكتب
  // reminderTime = تذكير الانتهاء (افتراضي 13:00)، reportTime = تقرير المدير (افتراضي 23:55)
  cron.schedule("* * * * *", async () => {
    const nowHM = baghdadHHMM();
    // القائد فقط ينفّذ العمل (إرسال/مزامنة/تنظيف) — يمنع الازدواج عند تعدّد الحواسيب
    const { isLeaderNow, getWorkerAgentId } = await import("@/lib/hybridAgent");
    if (!isLeaderNow()) return;
    // القائد يستضيف واتساب لكل المكاتب (يشمل حالة تولّي القيادة بعد انطفاء غيره)
    void ensureOfficeWhatsApp();
    // أوقات وكيل هذا العامل حصراً (عزل الوكلاء): كل قائد وكيلٍ يقرأ أوقاته هو —
    // تغيير وكيلٍ لأوقاته لا يمسّ بقية الوكلاء (كانت المفاتيح عامة مشتركة — سُدّت)
    const { getAgentSetting } = await import("@/lib/agentSettings");
    const wAgent = getWorkerAgentId();
    const reminderTime = await getAgentSetting("reminderTime", wAgent, "13:00");
    // تذكير الانتهاء: وقتٌ خاص لكل مكتب (towers.reminderTime — مرتبط بوقت تشغيل حاسبته:
    // مكتب يفتح 12:00 وآخر 2:00)، والمكتب بلا وقتٍ خاص يتبع وقت الوكيل العام.
    // الإرسال التلقائي فقط لمكاتب "الإرسال الصامت" (silent != "0")؛
    // مكاتب غير الصامتة تنتظر موافقة المستخدم عند أول دخول يومي.
    {
      const offs = await prisma.tower.findMany({
        where: {
          isDeleted: false,
          ...(wAgent != null ? { agentId: wAgent } : {}), // عزل: مكاتب وكيل هذا العامل حصراً
          NOT: { OR: [{ silent: "0" }, { waEnabled: "0" }] },
        },
        select: { id: true, reminderTime: true },
      }).catch(() => [] as { id: number; reminderTime: string | null }[]);
      const due = offs.filter((o) => (o.reminderTime?.trim() || reminderTime) === nowHM).map((o) => o.id);
      if (due.length) {
        // { claimDay } — المسارُ التلقائيُّ وحدَه يحجز يومَ المكتب قبل أوّل رسالة (ب-١/الأصل ٢)
        runExpiringReminder(due, { claimDay: true }).catch((e) => console.error("[scheduler] expiring:", e));
      }
    }
    // رسائل الديون اليومية: لمكاتب فعّلت الخانة، بوقتها الخاص debtReminderTime (أو وقت تذكير المكتب/الوكيل).
    // عزل: مكاتب وكيل هذا العامل حصراً (agentId).
    {
      const debtOffs = await prisma.tower.findMany({
        where: { isDeleted: false, debtReminderEnabled: "1", NOT: { waEnabled: "0" }, ...(wAgent != null ? { agentId: wAgent } : {}) },
        select: { id: true, reminderTime: true, debtReminderTime: true },
      }).catch(() => [] as { id: number; reminderTime: string | null; debtReminderTime: string | null }[]);
      // وقتٌ خاصّ برسائل الديون إن وُجد، وإلّا يتبع وقت تذكير الانتهاء (ثمّ وقت الوكيل العام)
      const dueDebt = debtOffs.filter((o) => (o.debtReminderTime?.trim() || o.reminderTime?.trim() || reminderTime) === nowHM).map((o) => o.id);
      if (dueDebt.length) {
        runDebtReminder(dueDebt, { claimDay: true }).catch((e) => console.error("[scheduler] debtReminder:", e));
      }
    }
    // البند ٤-أ · «المنتهون منذ N يوم»: للمكاتب التي فعّلت الخانة، بوقتها الخاصّ
    // (`expiredNoticeTime` ← وقتُ تذكير الانتهاء ← وقتُ الوكيل). وعزلٌ بـ`agentId`.
    // 🔑 والتفعيلُ **صريحٌ لا افتراضيّ**: ميزةٌ تُرسل رسائلَ لا تُشتغل بنفسها على مكاتبَ
    //    لم يطلبها أصحابُها — فمَن لم يُفعّلها لا يتغيّر عنده شيء.
    {
      const expOffs = await prisma.tower.findMany({
        where: { isDeleted: false, expiredNoticeEnabled: "1", NOT: { waEnabled: "0" }, ...(wAgent != null ? { agentId: wAgent } : {}) },
        select: { id: true, reminderTime: true, expiredNoticeTime: true },
      }).catch(() => [] as { id: number; reminderTime: string | null; expiredNoticeTime: string | null }[]);
      const dueExp = expOffs.filter((o) => (o.expiredNoticeTime?.trim() || o.reminderTime?.trim() || reminderTime) === nowHM).map((o) => o.id);
      if (dueExp.length) {
        runExpiredNotice(dueExp, { claimDay: true }).catch((e) => console.error("[scheduler] expiredNotice:", e));
      }
    }
    // البند ٤-ب · تصريفُ طابور «فعّل بنفسه» كلَّ عشر دقائق.
    // 🔑 ولا يكفي التصريفُ على حدث «ready»: لو كان الواتسابُ جاهزاً وفشل إرسالٌ عارضٌ
    //    (شبكةٌ لحظيّة) لَبقي الصفُّ معلَّقاً ولا حدثَ جهوزيّةٍ جديدٌ يأتي — فيموت بعد
    //    ٢٤ ساعةً بلا محاولةٍ ثانية. فالحدثُ للاستئناف السريع، والدورةُ للضمان.
    if (Number(nowHM.slice(3)) % 10 === 0) {
      const waOffs = await prisma.tower.findMany({
        where: { isDeleted: false, NOT: { waEnabled: "0" }, ...(wAgent != null ? { agentId: wAgent } : {}) },
        select: { id: true },
      }).catch(() => [] as { id: number }[]);
      for (const o of waOffs) {
        import("@/lib/selfActivatedNotice")
          .then((m) => m.drainSelfActivatedQueue(o.id))
          .catch((e) => console.error("[scheduler] طابور «فعّل بنفسه» سقط صامتاً:", e instanceof Error ? e.message : e)); // متوسّط(٢٦)
      }
    }
    // (أُزيل تقرير المدير عبر واتساب — حلقة زائدة؛ المدير يرى تقارير كل الأيّام في «حسابات المدير».)
    // نسخة احتياطية يومية إلى إيميل الوكيل (افتراضي 04:00 بغداد).
    // قائد كل وكيل ينفّذها لوكيله فقط بوقت وكيله (تفادي التكرار وعزل الأوقات).
    const backupTime = await getAgentSetting("backupTime", wAgent, "04:00");
    if (nowHM === backupTime) {
      import("@/lib/backupJob").then((m) => m.runDailyBackups(wAgent)).catch((e) => console.error("[scheduler] dailyBackup:", e));
    }
    // 🛡️ حارسُ المال · شبكةُ أمانٍ كلَّ عشر دقائق.
    // 🔑 والفحصُ الأساسيُّ **فوريٌّ عند الحذف** (طلبُ محمد)، وهذه الدورةُ لِما لا يُدركه
    //    الفوريّ: دفعةٌ كبيرةٌ تجاوزت GUARD_INLINE_MAX، أو ساسٌ ساقطٌ لحظةَ الحذف، أو
    //    عمليّةٌ انتهت قبل أن يُكمل فحصُ الخلفيّة. فلا يبقى صفٌّ pending أبداً.
    if (Number(nowHM.slice(3)) % 10 === 0) {
      import("@/lib/cardDeleteGuard")
        .then((m) => m.inspectPendingDeletedCards(30, wAgent))
        .catch((e) => console.error("[scheduler] دورةُ حارس المال سقطت صامتةً:", e instanceof Error ? e.message : e)); // متوسّط(٢٦)
    }
    // ⛔ **مسحُ كلِّ الكروت في الساس أُلغي (قرارُ محمد 2026-08-14)**: «طريقةُ فحصِ الكروت
    //    مشكلةٌ كبيرة لأنّه **يزيد الفاتورة**. يكفي أنّ الحارسَ يشتغل عند حذفِ كارتٍ فيأخذ
    //    **ذلك الكارتَ وحدَه** ويفحصه بالطريقة التي اتّفقنا عليها وينتهي الموضوع — لأنّ
    //    **المزامنةَ اليوميّةَ تفحص جميعَ الكروت يوميّاً أصلاً**.»
    //    ⚖️ وكان المسحُ ٣٠ كارتاً/١٠د = ~٤٣٠٠ نداءَ ساسٍ يوميّاً **لمعلومةٍ تُنتجها
    //    المزامنةُ مجّاناً**. فالفحصُ الموجَّه بقي في مكانه الصحيح: `cardDeleteGuard`
    //    لحظةَ الحذف (كارتٌ واحد)، و`card_serial_reused` بلا ساسٍ أصلاً.
    // مزامنة اشتراكات كل مكتب حسب وقته المضبوط (مرحلتان: كروت الأمس ثم تصحيح التواريخ)
    try {
      const offices = await prisma.tower.findMany({ where: { isDeleted: false, syncEnabled: "1", syncTime: { not: null }, ...(wAgent != null ? { agentId: wAgent } : {}) }, select: { id: true, syncTime: true } });
      for (const o of offices) {
        if ((o.syncTime ?? "").trim() === nowHM) {
          const { runOfficeSyncAll } = await import("@/lib/subscriptionSync");
          runOfficeSyncAll(o.id).catch((e) => console.error(`[scheduler] sync office ${o.id}:`, e));
        }
      }
    } catch (e) { console.error("[scheduler] sync tick:", e); }

    // إلغاء ما لم يُرسل (لا إعادة إرسال — محاولة واحدة فقط لكل رسالة)
    try {
      await cancelUnsentMessages();
    } catch (e) { console.error("[scheduler] cancel unsent:", e); }

    // بصمة خروج تلقائية (00:15 بغداد): إغلاق حضور من نسي الخروج بوقت الخروج المثبّت + غرامة
    if (nowHM === "00:15") {
      import("@/lib/autoCheckout").then((m) => m.runAutoCheckout({ resetSupport: true })).then((r) => { if (r.closed || r.supportEnded) console.log(`[scheduler] خروج تلقائي: أُغلق ${r.closed} حضور، أُنهي ${r.supportEnded} دعم`); }).catch((e) => console.error("[scheduler] autoCheckout:", e));
    }

    // تنظيف يومي (03:00 بغداد): حذف أرشيف الرسائل >3 أيام، والمشتركين المحوّلين >30 يوماً دون تفعيل
    if (nowHM === "03:00") {
      purgeOldMessages(3).catch((e) => console.error("[scheduler] purge messages:", e));
      purgeTransferredSubscribers(30).catch((e) => console.error("[scheduler] purge transferred:", e));
      // حذف نهائي لبطاقات الأرشيف الأقدم من أسبوع (احتياط محلي — الكرون السحابي يفعلها أيضاً)
      import("@/lib/field").then((m) => m.purgeOldArchivedCards()).catch((e) => console.error("[scheduler] purge archive:", e));
    }
  }, { timezone: TZ });

  console.log("[scheduler] started (Asia/Baghdad): تذكير الانتهاء (افتراضي 13:00) حسب الإعدادات");

  // بدء واتساب ومهام الإقلاع بعد ~5ث (بعد أول نبضة تحسم القيادة) — للقائد فقط
  setTimeout(async () => {
    const { isLeaderNow } = await import("@/lib/hybridAgent");
    if (!isLeaderNow()) return;
    void ensureOfficeWhatsApp();
    // تدارك بصمة الخروج المنسيّة لأيامٍ سابقة عند إقلاع الحاسبة صباحاً (تُغلَق ولو كانت الحاسبات
    // مغلقة ساعة الجدولة 00:15). لا يحتاج واتساب — يُنفَّذ فوراً.
    import("@/lib/autoCheckout").then((m) => m.runAutoCheckout()).then((r) => { if (r.closed) console.log(`[scheduler] تدارك خروج تلقائي عند الإقلاع: أُغلق ${r.closed}`); }).catch((e) => console.error("[scheduler] startup autoCheckout:", e));
    // بعد إتاحة وقت لاتصال الواتساب: إلغاء ما لم يُرسل
    setTimeout(() => {
      cancelUnsentMessages().catch((e) => console.error("[scheduler] startup cancel:", e));
    }, 30000);
  }, 5000);
}
