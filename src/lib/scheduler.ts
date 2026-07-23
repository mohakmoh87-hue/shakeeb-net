import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { dailyReportText, computeDailyReport } from "@/lib/dailyReport";
import { formatDate } from "@/lib/format";

// مجدول المهام: يعمل داخل عملية الخادم (توقيت العراق).
// يُسجَّل مرة واحدة عبر instrumentation.ts.

const g = globalThis as unknown as { __schedulerStarted?: boolean };

const TZ = "Asia/Baghdad";


// جلب قالب رسالة حسب التصنيف
// قالب المكتب المخصّص أولاً ثم قالب الوكيل العام (عزل المستأجر والمكتب)
async function getTemplate(type: string, agentId: number | null, towerId?: number | null): Promise<string | null> {
  const { getEffectiveTemplate } = await import("@/lib/smsTemplates");
  return getEffectiveTemplate(type, agentId, towerId); // قالب المكتب ← الوكيل ← الافتراضي؛ null إن مُعطَّل
}

// تاريخ يوم معيّن بصيغة YYYY-MM-DD (توقيت بغداد)
function baghdadDateStr(d: Date): string {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function baghdadToday(): string { return baghdadDateStr(new Date()); }
function baghdadYesterday(): Date { return new Date(Date.now() - 24 * 60 * 60 * 1000); }

// ===== تذكير المشتركين المنتهين خلال يومين — لمكاتب محدّدة (أو الكل) =====
export async function runExpiringReminder(officeIds?: number[]): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  const limit = new Date();
  limit.setDate(limit.getDate() + 2); // خلال يومين

  const recipients = await prisma.subscriber.findMany({
    where: {
      isDeleted: false,
      waEnabled: true,
      dateTo: { not: null, gte: now, lte: limit },
      ...(officeIds ? { towerId: { in: officeIds } } : {}),
    },
  });
  const packages = await prisma.package.findMany({ select: { id: true, name: true, priceDinar: true } });
  const priceMap = new Map(packages.map((p) => [p.id, p.priceDinar ?? 0]));
  const pkgNameMap = new Map(packages.map((p) => [p.id, p.name]));
  const offices = await prisma.tower.findMany({ select: { id: true, name: true, waEnabled: true, agentId: true } });
  const officeMap = new Map(offices.map((o) => [o.id, o]));
  // اسم النظام الافتراضي لكل وكيل (معزول) — يُقرأ بحسب وكيل مكتب كل مستلم مع تخزين مؤقت
  const { getAgentSetting } = await import("@/lib/agentSettings");
  const fallbackCache = new Map<number | null, string>();
  const fallbackOfficeFor = async (aid: number | null): Promise<string> => {
    if (!fallbackCache.has(aid)) fallbackCache.set(aid, await getAgentSetting("office", aid, "SHAKEEB"));
    return fallbackCache.get(aid)!;
  };
  // قالب "expiring" لكل (وكيل، مكتب) — يُجلب مرّة ويُخزَّن؛ قالب المكتب يغلب قالب الوكيل
  const tplCache = new Map<string, string | null>();
  async function templateFor(agentId: number | null, towerId: number | null): Promise<string | null> {
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
    const template = await templateFor(office?.agentId ?? null, sub.towerId ?? null);
    if (!template) continue; // لا قالب مفعّل لوكيل هذا المكتب
    if (i++ > 0) await sleep(10000); // تأخير 10 ثوانٍ بين رسالة وأخرى
    const text = renderTemplate(template, {
      name: sub.name,
      netUser: sub.netUser,
      package: sub.packageId ? pkgNameMap.get(sub.packageId) ?? "" : "",
      phone: sub.phone,
      dateTo: sub.dateTo ? formatDate(sub.dateTo) : "",
      carry: sub.carry ?? 0,
      remaining: sub.carry ?? 0,
      price: sub.packageId ? priceMap.get(sub.packageId) ?? 0 : 0,
      code: sub.rewardCode, balance: sub.rewardBalance ?? 0, // كود/رصيد الخصم (فارغ لمن لا رصيد له)
      office: office?.name ?? (await fallbackOfficeFor(office?.agentId ?? null)),
    });
    const res = await sendViaProvider("WHATSAPP", sub.phone, text, sub.towerId); // واتساب مكتب المشترك
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
        createdByUser: "scheduler",
      },
    });
    res.ok ? sent++ : failed++;
  }

  // ختم "عولج اليوم" على المكاتب المعنيّة (لمنع تكرار طلب الموافقة عند الدخول)
  const today = baghdadToday();
  if (officeIds && officeIds.length) {
    await prisma.tower.updateMany({ where: { id: { in: officeIds } }, data: { lastReminderDate: today } });
  }
  return { sent, failed };
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
    select: { id: true, name: true, managerPhone: true },
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
    const text = await dailyReportText(office.name ?? "المكتب", office.id, targetDay); // تقرير هذا المكتب لليوم المحدّد
    const res = await sendViaProvider("WHATSAPP", phone, text, office.id); // من واتساب هذا المكتب
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
        createdByUser: "scheduler",
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

// ===== إفراغ كل رسائل الواتساب المؤجّلة (المعلّقة أو التي فشلت لانقطاع الاتصال) =====
// يُستدعى عند التشغيل ودورياً؛ يُعيد إرسالها من واتساب مكتب كلٍّ منها.
export async function flushPendingMessages(): Promise<{ resent: number }> {
  const msgs = await prisma.message.findMany({
    where: {
      channel: "WHATSAPP",
      OR: [{ status: "PENDING" }, { status: "FAILED", error: { contains: "متصل" } }],
    },
    orderBy: { id: "asc" },
    take: 200,
  });
  if (!msgs.length) return { resent: 0 };

  // تحديد مكتب كل رسالة: عبر المشترك (towerId) أو عبر رقم المدير للتقارير
  const subIds = [...new Set(msgs.map((m) => m.subscriberId).filter(Boolean))] as number[];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, towerId: true } })
    : [];
  const subTower = new Map(subs.map((s) => [s.id, s.towerId]));
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false, managerPhone: { not: null } },
    select: { id: true, managerPhone: true },
  });
  const officeByPhone = new Map(offices.map((o) => [(o.managerPhone ?? "").trim(), o.id]));

  let resent = 0;
  for (const m of msgs) {
    if (!m.phone) continue;
    let officeId: number | null = m.subscriberId ? subTower.get(m.subscriberId) ?? null : null;
    if (officeId == null) officeId = officeByPhone.get((m.phone ?? "").trim()) ?? null;
    if (officeId == null) continue;
    // تقارير المزامنة المؤجّلة: نُنبّه بتأخّر الإرسال
    const prefix = m.createdByUser === "sync-report"
      ? "⏳ تأخر إرسال التقرير بسبب انقطاع اتصال الواتساب وقت المزامنة.\n\n"
      : "";
    const res = await sendViaProvider("WHATSAPP", m.phone, prefix + m.text, officeId);
    if (res.ok) {
      await prisma.message.update({ where: { id: m.id }, data: { status: "SENT", error: null } });
      resent++;
    }
  }
  return { resent };
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
    })).filter((o) => hostsOfficeLocally(o.id));
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
    const reportTime = await getAgentSetting("reportTime", wAgent, "23:55");
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
        runExpiringReminder(due).catch((e) => console.error("[scheduler] expiring:", e));
      }
    }
    if (nowHM === reportTime) {
      // احتياطي: يُرسل تقرير أي مكتب لم يُرسَل تقريره اليوم (لمن أطفأ دون تسجيل خروج)
      runManagerDailyReport(undefined, { oncePerDay: true }).catch((e) => console.error("[scheduler] managerReport:", e));
    }
    // نسخة احتياطية يومية إلى إيميل الوكيل (افتراضي 04:00 بغداد).
    // قائد كل وكيل ينفّذها لوكيله فقط بوقت وكيله (تفادي التكرار وعزل الأوقات).
    const backupTime = await getAgentSetting("backupTime", wAgent, "04:00");
    if (nowHM === backupTime) {
      import("@/lib/backupJob").then((m) => m.runDailyBackups(wAgent)).catch((e) => console.error("[scheduler] dailyBackup:", e));
    }
    // مزامنة اشتراكات كل مكتب حسب وقته المضبوط (مرحلتان: كروت الأمس ثم تصحيح التواريخ)
    try {
      const offices = await prisma.tower.findMany({ where: { isDeleted: false, syncEnabled: "1", syncTime: { not: null }, ...(wAgent != null ? { agentId: wAgent } : {}) }, select: { id: true, syncTime: true } });
      for (const o of offices) {
        if ((o.syncTime ?? "").trim() === nowHM) {
          const { runOfficeSync } = await import("@/lib/subscriptionSync");
          runOfficeSync(o.id).catch((e) => console.error(`[scheduler] sync office ${o.id}:`, e));
        }
      }
    } catch (e) { console.error("[scheduler] sync tick:", e); }

    // إفراغ كل الرسائل المؤجّلة (من أي نوع) عند عودة اتصال الواتساب
    try {
      await flushPendingMessages();
    } catch (e) { console.error("[scheduler] flush pending:", e); }

    // بصمة خروج تلقائية (00:15 بغداد): إغلاق حضور من نسي الخروج بوقت الخروج المثبّت + غرامة
    if (nowHM === "00:15") {
      import("@/lib/autoCheckout").then((m) => m.runAutoCheckout()).then((r) => { if (r.closed) console.log(`[scheduler] خروج تلقائي: أُغلق ${r.closed} حضور`); }).catch((e) => console.error("[scheduler] autoCheckout:", e));
    }

    // تنظيف يومي (03:00 بغداد): حذف أرشيف الرسائل >3 أيام، والمشتركين المحوّلين >30 يوماً دون تفعيل
    if (nowHM === "03:00") {
      purgeOldMessages(3).catch((e) => console.error("[scheduler] purge messages:", e));
      purgeTransferredSubscribers(30).catch((e) => console.error("[scheduler] purge transferred:", e));
      // حذف نهائي لبطاقات الأرشيف الأقدم من أسبوع (احتياط محلي — الكرون السحابي يفعلها أيضاً)
      import("@/lib/field").then((m) => m.purgeOldArchivedCards()).catch((e) => console.error("[scheduler] purge archive:", e));
    }
  }, { timezone: TZ });

  console.log("[scheduler] started (Asia/Baghdad): تذكير الانتهاء (افتراضي 13:00) وتقرير المدير (افتراضي 23:55) حسب الإعدادات");

  // بدء واتساب ومهام الإقلاع بعد ~5ث (بعد أول نبضة تحسم القيادة) — للقائد فقط
  setTimeout(async () => {
    const { isLeaderNow } = await import("@/lib/hybridAgent");
    if (!isLeaderNow()) return;
    void ensureOfficeWhatsApp();
    // تدارك بصمة الخروج المنسيّة لأيامٍ سابقة عند إقلاع الحاسبة صباحاً (تُغلَق ولو كانت الحاسبات
    // مغلقة ساعة الجدولة 00:15). لا يحتاج واتساب — يُنفَّذ فوراً.
    import("@/lib/autoCheckout").then((m) => m.runAutoCheckout()).then((r) => { if (r.closed) console.log(`[scheduler] تدارك خروج تلقائي عند الإقلاع: أُغلق ${r.closed}`); }).catch((e) => console.error("[scheduler] startup autoCheckout:", e));
    // بعد إتاحة وقت لاتصال الواتساب: تدارك تقرير الأمس + إفراغ الرسائل المؤجّلة
    setTimeout(() => {
      catchUpManagerReport().catch((e) => console.error("[scheduler] catchup report:", e));
      flushPendingMessages().catch((e) => console.error("[scheduler] startup flush:", e));
    }, 30000);
  }, 5000);
}
