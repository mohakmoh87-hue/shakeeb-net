import { prisma } from "@/lib/prisma";
import {
  sasBaseUrl, sasLogin, sasFetchActivationsForDay, sasFetchAllUsers, sasSearchActivation,
  sasSearchActivationStrict,
  type SasActivation,
} from "@/lib/sas4";
import { sendViaProvider } from "@/lib/messaging";
import { formatDate } from "@/lib/format";
import { iraqYesterdayRange, iraqTodayRange } from "@/lib/dailyReport";

// ============================================================================
// المزامنة اليومية مع SAS — نسخة مطوّرة على مرحلتين متتاليتين لكل مكتب:
//   المرحلة 1: كروت وتفعيلات "الأمس" (السيناريوهات 1،2،3،6،7) + معالجة الحسابات.
//   المرحلة 2: تصحيح تواريخ/أيام الانتهاء لجميع مشتركي المكتب (السيناريوهان 4،5) بصمت.
// مقاومة الأعطال: لا تنهار عند توقف SAS، وتحفظ التقرير وتعيد إرساله عند عودة الواتساب.
// ============================================================================

// حدث يستحق إبلاغ المدير (السيناريوهات 1،2،3،6،7 فقط؛ 4،5 صامتة)
export type SyncEvent = {
  scenario: 1 | 2 | 3 | 6 | 7;
  subscriber: string | null;
  pin?: string | null;
  detail?: string;
};

export interface SyncResult {
  office: string;
  phase1: {
    activations: number; internal: number; external: number;
    phantom: number; markedUsed: number; duplicates: number; imported: number;
    verifiedReal: number; // كروت مُستخدمة أمس أُكّد تفعيلها في SAS ببحث مباشر (ليست وهمية)
  };
  phase2: { checked: number; dateFixed: number; imported: number; failed: boolean; skippedPkg: number };
  events: SyncEvent[];
  reportSent: boolean | null; // true=أُرسل، false=مؤجّل (واتساب مقطوع)، null=لا تقرير
  error?: string;
}

// نافذة يوم يشمل تاريخاً معيّناً (لمطابقة تاريخ استخدام كارت البرنامج مع نطاق الأمس)
function withinRange(d: Date | null | undefined, start: Date, end: Date): boolean {
  if (!d) return false;
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

// هل تاريخ انتهاء الساس أحدث (أبعد) من تاريخ البرنامج؟ (مقارنة بمستوى اليوم التقويمي).
// المزامنة تُمدّد التاريخ للأمام فقط: برنامج بلا تاريخ ⇒ يُضبط من الساس؛ الساس أبعد ⇒ يُضبط؛
// البرنامج أبعد أو مساوٍ ⇒ لا تغيير إطلاقاً (لا نُقصّر تاريخ انتهاء أي مشترك).
function sasDateIsLater(programDate: Date | null | undefined, sasDate: Date): boolean {
  if (!programDate) return true;
  const dp = new Date(programDate.getFullYear(), programDate.getMonth(), programDate.getDate()).getTime();
  const ds = new Date(sasDate.getFullYear(), sasDate.getMonth(), sasDate.getDate()).getTime();
  return ds > dp;
}

// تفعيل بكارت (voucher)؟ الكارت في حقل pin؛ نستبعد التفعيل برصيد المستخدم
function isCardActivation(a: SasActivation): boolean {
  const pin = (a.pin ?? "").trim();
  if (!pin) return false;
  const m = (a.method ?? "").toLowerCase();
  return !/credit/.test(m); // voucher أو غير محدّد = كارت
}

// إرسال تقرير المدير — محاولة واحدة فقط. إن لم يُرسل يُسجَّل فاشلاً ولا يُعاد إرساله
// إطلاقاً (الإعادة كانت تُوصل الرسالة نفسها مرّات عدّة حين تنتهي المهلة دون أن تفشل فعلاً).
async function sendOrQueueReport(officeId: number, phone: string, text: string): Promise<boolean> {
  const res = await sendViaProvider("WHATSAPP", phone, text, officeId);
  await prisma.message.create({
    data: {
      channel: "WHATSAPP", phone, text,
      status: res.ok ? "SENT" : "FAILED",
      error: res.ok ? null : (res.error ?? "واتساب غير متصل"),
      createdByUser: "sync-report",
    },
  });
  return res.ok;
}

// قفل تزامن: يمنع تشغيل مزامنتين لنفس المكتب في آن واحد. كان الضغط المتكرّر على
// «مزامنة الآن» يُشغّل نسخاً متوازية تقرأ الحالة نفسها فتُكرّر المعالجة والإرجاع.
const syncRunning = new Set<number>();

// تشغيل المزامنة لمكتب واحد (مرحلتان). forDay اختياري لأغراض الاختبار؛ الافتراضي "الأمس".
// notify: يُرسل تقرير المدير فقط في المزامنة التلقائية (المجدول). المزامنة اليدوية (زر «مزامنة الآن») لا تُرسل شيئاً.
export async function runOfficeSync(
  officeId: number,
  opts: { forDay?: Date; notify?: boolean } = {},
): Promise<SyncResult> {
  if (syncRunning.has(officeId)) {
    return {
      office: "المكتب",
      phase1: { activations: 0, internal: 0, external: 0, phantom: 0, markedUsed: 0, duplicates: 0, imported: 0, verifiedReal: 0 },
      phase2: { checked: 0, dateFixed: 0, imported: 0, failed: false, skippedPkg: 0 },
      events: [], reportSent: null,
      error: "مزامنة هذا المكتب قيد التنفيذ بالفعل — تم تجاهل الطلب المكرّر",
    };
  }
  syncRunning.add(officeId);
  try {
    return await runOfficeSyncInner(officeId, opts);
  } finally {
    syncRunning.delete(officeId);
  }
}

async function runOfficeSyncInner(
  officeId: number,
  { forDay, notify = true }: { forDay?: Date; notify?: boolean } = {},
): Promise<SyncResult> {
  const office = await prisma.tower.findUnique({
    where: { id: officeId },
    select: { id: true, name: true, loginUrl: true, username: true, password: true, managerPhone: true },
  });
  const officeName = office?.name ?? "المكتب";
  const empty: SyncResult = {
    office: officeName,
    phase1: { activations: 0, internal: 0, external: 0, phantom: 0, markedUsed: 0, duplicates: 0, imported: 0, verifiedReal: 0 },
    phase2: { checked: 0, dateFixed: 0, imported: 0, failed: false, skippedPkg: 0 },
    events: [], reportSent: null,
  };

  if (!office?.loginUrl || !office.username || !office.password) {
    return { ...empty, error: "المكتب لا يحتوي بيانات SAS كاملة" };
  }

  // نطاق "الأمس" بتوقيت العراق
  const { start, end } = iraqYesterdayRange(forDay ?? new Date());
  const officeUser = office.username.trim().toLowerCase();

  // تسجيل الدخول — عند فشل SAS: إشعار المدير وعدم الانهيار
  let base: string, token: string;
  try {
    base = sasBaseUrl(office.loginUrl);
    token = await sasLogin(base, office.username, office.password);
  } catch (e) {
    if (notify) await notifySasDown(office.id, office.managerPhone, officeName);
    return { ...empty, error: (e as Error).message || "فشل الاتصال بـ SAS" };
  }

  // جلب التفعيلات بنافذة موسّعة: **الأمس + اليوم** — عند فشل SAS: إشعار وعدم الانهيار.
  // سبب التوسيع: وقت التفعيل في البرنامج ووقته في الساس قد يقعان على جانبَي منتصف الليل
  // (أو يختلفان بفارق توقيت)، فيبدو كارتٌ مستخدمٌ فعلاً بلا تفعيل مقابل ⇒ إنذار «وهمي» كاذب.
  const todayEnd = iraqTodayRange(forDay ?? new Date()).end;
  let actsWide: SasActivation[];
  try {
    actsWide = await sasFetchActivationsForDay(base, token, start, todayEnd);
  } catch (e) {
    if (notify) await notifySasDown(office.id, office.managerPhone, officeName);
    return { ...empty, error: (e as Error).message || "فشل جلب تقرير التفعيلات" };
  }
  // السيناريوهات المُبلَّغة (تكرار/كارت خارجي/استيراد/تحديث حالة) تبقى على تفعيلات **الأمس**
  // حصراً — كي لا تتكرّر التقارير ولا تظهر «تفعيلات مكرّرة» كاذبة لمن فعّل أمس واليوم.
  const acts = actsWide.filter((a) => {
    const d = a.createdAt ? new Date(a.createdAt) : null;
    return d != null && !isNaN(d.getTime()) && d >= start && d <= end;
  });

  // ===================== المرحلة 1: كروت وتفعيلات الأمس =====================
  const events: SyncEvent[] = [];
  let internal = 0, external = 0, phantom = 0, markedUsed = 0, duplicates = 0, imported = 0;

  // كل كروت البرنامج (البِن → الكارت)
  const cards = await prisma.rechargeCard.findMany({
    select: { id: true, serial: true, useDate: true, subscriberId: true },
  });
  const cardBySerial = new Map(cards.map((c) => [(c.serial ?? "").trim(), c]));

  // مشتركو هذا المكتب (بالـ sasId) لمعرفة الجدد ومطابقة الكروت
  const officeSubs = await prisma.subscriber.findMany({
    where: { towerId: officeId, isDeleted: false },
    select: { id: true, sasId: true, name: true, netUser: true },
  });
  const subBySasId = new Map(officeSubs.filter((s) => s.sasId).map((s) => [s.sasId as number, s]));
  const subById = new Map(officeSubs.map((s) => [s.id, s]));

  // مجموعة (مشترك SAS | بِن) من **النافذة الموسّعة** (الأمس + اليوم) — تُستخدم للتحقّق من
  // «التفعيل الوهمي» فقط. توسيعها يمنع اعتبار كارتٍ حقيقيٍّ وهمياً لمجرّد وقوع تفعيله
  // بعد منتصف الليل بتوقيت الساس (أو اختلاف التوقيت بين البرنامج والساس).
  const sasUserPinSet = new Set<string>();
  for (const a of actsWide) {
    const pin = (a.pin ?? "").trim();
    if (pin) sasUserPinSet.add(`${a.sasUserId}|${pin}`);
  }
  // تجميع تفعيلات **الأمس** حسب مشترك SAS (لكشف التكرار — السيناريو 2)
  const actsByUser = new Map<number, SasActivation[]>();
  for (const a of acts) {
    const list = actsByUser.get(a.sasUserId) ?? [];
    list.push(a);
    actsByUser.set(a.sasUserId, list);
  }

  for (const a of acts) {
    const pin = (a.pin ?? "").trim();
    const card = pin ? cardBySerial.get(pin) : undefined;
    const managerMatch = (a.managerUsername ?? "").trim().toLowerCase() === officeUser;

    // السيناريو 7: مشترك جديد في SAS غير موجود بالبرنامج → استيراد تلقائي + إبلاغ
    let sub = subBySasId.get(a.sasUserId);
    if (!sub) {
      const newDate = a.newExpiration ? new Date(a.newExpiration) : null;
      const created = await prisma.subscriber.create({
        data: {
          name: a.name, netUser: a.username, sasId: a.sasUserId, towerId: officeId,
          dateTo: newDate && !isNaN(newDate.getTime()) ? newDate : null, createdByUser: "sync",
        },
      });
      sub = { id: created.id, sasId: a.sasUserId, name: a.name, netUser: a.username };
      subBySasId.set(a.sasUserId, sub);
      subById.set(created.id, sub);
      imported++;
      events.push({ scenario: 7, subscriber: a.name ?? a.username, detail: "استيراد مشترك جديد من SAS" });
    }

    if (card) {
      internal++;
      // السيناريو 3: الكارت في البرنامج لكنه "غير مستخدم" بينما SAS يعتبره مستخدماً → تحديث
      if (!card.useDate) {
        const when = a.createdAt ? new Date(a.createdAt) : new Date();
        await prisma.rechargeCard.update({
          where: { id: card.id },
          data: { useDate: isNaN(when.getTime()) ? new Date() : when, subscriberId: sub.id, userName: "sync" },
        });
        card.useDate = when; // تحديث محلي لتفادي إعادة المعالجة
        markedUsed++;
        events.push({ scenario: 3, subscriber: sub.name ?? sub.netUser, pin, detail: "تحديث حالة الكارت إلى مستخدم" });
      }
    } else if (isCardActivation(a) && managerMatch) {
      // السيناريو 6: Manager يطابق يوزر المكتب لكن الكارت غير موجود بمخزن البرنامج → كارت خارجي
      external++;
      events.push({ scenario: 6, subscriber: sub.name ?? sub.netUser, pin, detail: "تفعيل بكارت خارجي غير موجود بالمخزن" });
    } else if (isCardActivation(a)) {
      // كارت غير معروف من Manager آخر — لا يُبلَّغ عنه هنا (تصحيح التاريخ يتم بالمرحلة 2 بصمت — السيناريو 5)
      external++;
    }
  }

  // السيناريو 2: تفعيل متكرر في SAS لنفس المشترك بنفس اليوم بينما البرنامج يعرف كارتاً واحداً
  for (const [sasUserId, list] of actsByUser) {
    const cardActs = list.filter(isCardActivation);
    if (cardActs.length > 1) {
      const sub = subBySasId.get(sasUserId);
      const programUsed = sub
        ? cards.filter((c) => c.subscriberId === sub.id && withinRange(c.useDate, start, end)).length
        : 0;
      if (programUsed <= 1) {
        duplicates++;
        events.push({
          scenario: 2, subscriber: sub?.name ?? list[0]?.username ?? null,
          detail: `SAS: ${cardActs.length} تفعيلات كارت، البرنامج: ${programUsed}`,
        });
      }
    }
  }

  // السيناريو 1: كارت "مستخدم" في البرنامج (أمس) لمشترك هذا المكتب لكن لا تفعيل مقابل في SAS
  //   الإجراء: إرجاع الكارت غير مستخدم إلى المخزن فقط — دون أي تغيير على ديون الكارتات (يبقى سعره كما هو) + إبلاغ.
  const usedYesterday = cards.filter(
    (c) => c.useDate && c.subscriberId != null && withinRange(c.useDate, start, end) && subById.has(c.subscriberId),
  );
  // المشتبه بهم مبدئياً: كارت مستخدم أمس بلا تفعيل مقابل في النافذة الموسّعة (الأمس + اليوم)
  const preSuspects = usedYesterday.filter((c) => {
    const sub = subById.get(c.subscriberId!);
    if (!sub?.sasId) return false;
    return !sasUserPinSet.has(`${sub.sasId}|${(c.serial ?? "").trim()}`);
  });

  // 🔎 تحقّق نهائي مباشر قبل أي إنذار: قد يكون الكارت مُفعّلاً فعلاً في SAS لكن لا يظهر في
  // القائمة المُرقّمة الافتراضية — إمّا لأن تاريخه خارج نافذة المزامنة، أو (كنمط ريسيلر
  // «المواصلات») لأن التفعيل تمّ تحت حساب فرعي، والقائمة الافتراضية تعرض تفعيلات المدير المباشرة
  // فقط بينما بحث SAS (search) يغطّي الشجرة الفرعية كاملة. فنبحث عن كل مشتبهٍ به بالسيريال؛ إن
  // وُجد فليس وهمياً. هذا يزيل الإيجابيات الكاذبة نهائياً (السبب الجذري لإنذارات المواصلات الـ57).
  // تنفيذ متوازٍ محدود (POOL) لتقليص الزمن الكلي (زمن شبكة SAS ~1.5ث/بحث)، مع حدٍّ أعلى؛ وعند
  // تجاوز الحد يُترك الباقي على تقدير النافذة (وضع آمن أصلاً لا يُغيّر شيئاً).
  const MAX_VERIFY = 500; // سقف حماية من حلقات ضخمة
  const POOL = 4;         // عدد الطلبات المتزامنة على SAS (خفيف: صف واحد لكل بحث)
  const toVerify = preSuspects.slice(0, MAX_VERIFY);
  const overflow = preSuspects.slice(MAX_VERIFY); // غير مُتحقَّق منه ⇒ يبقى مشتبهاً (نادر)
  const realFlags = new Array<boolean>(toVerify.length).fill(false);
  let vNext = 0;
  const worker = async () => {
    while (true) {
      const i = vNext++;
      if (i >= toVerify.length) break;
      const found = await sasSearchActivation(base, token, (toVerify[i].serial ?? "").trim());
      if (found) realFlags[i] = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, toVerify.length) }, worker));
  let verifiedReal = 0;
  const suspects: typeof preSuspects = [...overflow];
  for (let i = 0; i < toVerify.length; i++) {
    if (realFlags[i]) verifiedReal++;      // تفعيل حقيقي (بتاريخ/حساب فرعي مختلف) — ليس وهمياً
    else suspects.push(toVerify[i]);
  }

  // 🛡️ وضع آمن — إبلاغ فقط بلا أي تغيير على الكارت (يبقى سارياً حتى قرار صريح بإعادة التفعيل التلقائي):
  // السبب الجذري للإيجابيات الكاذبة اتّضح وعولِج: كانت المزامنة تعتمد نافذة «الأمس + اليوم» فقط،
  // فتُفوّت الكارت المُفعَّل في SAS بتاريخٍ مختلف عن يوم تعليمه مستخدماً في البرنامج (نمط ريسيلر
  // «المواصلات»). أضيف أعلاه تحقّق مباشر بالبحث بالسيريال (sasSearchActivation) يجد التفعيل مهما
  // كان تاريخه، فلم يبقَ «وهمياً» إلا كارتٌ لا وجود لتفعيله في SAS إطلاقاً — إنذار موثوق الآن.
  // ⚠️ وفي كل الأحوال: لا يُحذف أي وصل، ولا يُنقَص دين مشترك (carry) ولا دين كارت (price).
  for (const c of suspects) {
    const sub = subById.get(c.subscriberId!);
    phantom++;
    events.push({
      scenario: 1, subscriber: sub?.name ?? sub?.netUser ?? null, pin: c.serial,
      detail: `لا يوجد تفعيل مقابل في SAS (تحقّق مباشر) — لم يُغيَّر شيء (وضع آمن: يُدقَّق يدوياً)`,
    });
  }

  // تسجيل الكروت الوهمية في سجل التدقيق لتظهر في لوحة «الكروت الوهمية» بحسابات المدير
  // (ليقرّر المدير: إرجاع للمخزن أو حذف). ليس تغييراً على الكارت — الوضع الآمن باقٍ.
  // نستخدم إجراءً مستقلاً SYNC_PHANTOM_VERIFIED (لا SYNC_PHANTOM_CARD القديم الذي كتبه المنطق
  // السابق بلا تحقّق مباشر) — فلا تُخلط الإيجابيات الكاذبة القديمة بالمؤكَّدة بعد بحث SAS.
  // منع التكرار: لا يُعاد تسجيل كارت له تنبيه خلال آخر 45 يوماً.
  if (suspects.length > 0) {
    const since45 = new Date(Date.now() - 45 * 86400 * 1000);
    for (const c of suspects) {
      const sub = subById.get(c.subscriberId!);
      const exists = await prisma.auditLog.findFirst({
        where: { action: "SYNC_PHANTOM_VERIFIED", entityId: String(c.id), createdAt: { gte: since45 } },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.auditLog.create({
        data: {
          action: "SYNC_PHANTOM_VERIFIED", entity: "rechargeCard", entityId: String(c.id),
          details: `كارت وهمي (مؤكَّد ببحث SAS): سيريال ${c.serial ?? "؟"} — مشترك ${sub?.name ?? sub?.netUser ?? c.subscriberId} — مكتب ${officeName} — استُخدم ${c.useDate ? new Date(c.useDate).toISOString() : "؟"}`,
        },
      });
    }
  }

  // ===================== المرحلة 2: كل مشتركي المكتب في الساس =====================
  // تجلب كل مشتركي الساس (500/صفحة مع تأخير)، فتقوم بأمرين:
  //  (أ) استيراد كل مشترك موجود في الساس وغير موجود في البرنامج (استيراد شامل — السيناريو 7 لكامل القاعدة).
  //  (ب) تصحيح تاريخ الانتهاء بصمت للمشتركين الموجودين عند اختلافه (السيناريوهان 4 و5).
  let checked = 0, dateFixed = 0, phase2Imported = 0, phase2Failed = false, skippedPkg = 0;
  try {
    const allUsers = await sasFetchAllUsers(base, token);
    const progSubs = await prisma.subscriber.findMany({
      where: { towerId: officeId, isDeleted: false, sasId: { not: null } },
      select: { id: true, sasId: true, dateTo: true },
    });
    const progBySasId = new Map(progSubs.map((s) => [s.sasId as number, s]));

    // فئات الاشتراك التي أضافها المدير في البرنامج (للمطابقة بالاسم، بلا حساسية حالة/فراغات):
    // مشتركٌ فئته في الساس غير موجودة ضمنها ⇒ لا يُمَسّ إطلاقاً — لا تصحيح تاريخ انتهائه
    // ولا أيامه المتبقية (بطلب صريح: فئة مجهولة = اتركه كما هو)
    const progPackages = await prisma.package.findMany({ select: { name: true } });
    const knownPkg = new Set(progPackages.map((p) => (p.name ?? "").trim().toLowerCase()).filter(Boolean));

    const toImport: {
      name: string | null; netUser: string | null; phone: string | null;
      sasId: number; towerId: number; dateTo: Date | null; createdByUser: string;
    }[] = [];

    for (const u of allUsers) {
      const p = progBySasId.get(u.sasId);
      const sasDate = u.expiration ? new Date(u.expiration) : null;
      const validDate = sasDate && !isNaN(sasDate.getTime()) ? sasDate : null;

      if (!p) {
        // مشترك في الساس غير موجود بالبرنامج → استيراد شامل
        toImport.push({
          name: u.name, netUser: u.username, phone: u.phone,
          sasId: u.sasId, towerId: officeId, dateTo: validDate, createdByUser: "sync",
        });
        continue;
      }
      // موجود → لكن إن كانت فئته في الساس غير موجودة ضمن فئات البرنامج ⇒ لا أي تعديل
      // عليه (لا تاريخ انتهاء ولا أيام متبقية) — يُحصى فقط للتقرير.
      const sasPkg = (u.packageName ?? "").trim().toLowerCase();
      if (sasPkg && !knownPkg.has(sasPkg)) { skippedPkg++; continue; }

      // فئته معروفة → تمديد التاريخ للأمام فقط: إن كان تاريخ الساس أبعد من تاريخ
      // البرنامج نضبطه مثل الساس؛ وإن كان تاريخ البرنامج أبعد (أو مساوياً) لا نغيّر شيئاً.
      checked++;
      if (validDate && sasDateIsLater(p.dateTo, validDate)) {
        await prisma.subscriber.update({ where: { id: p.id }, data: { dateTo: validDate } });
        dateFixed++;
      }
    }

    // استيراد جماعي دفعة واحدة (خفيف على قاعدة البيانات)
    if (toImport.length) {
      const res = await prisma.subscriber.createMany({ data: toImport });
      phase2Imported = res.count;
    }
  } catch {
    phase2Failed = true; // لا نُسقط نتائج المرحلة 1
  }

  // ===================== التقرير =====================
  const result: SyncResult = {
    office: officeName,
    phase1: { activations: acts.length, internal, external, phantom, markedUsed, duplicates, imported, verifiedReal },
    phase2: { checked, dateFixed, imported: phase2Imported, failed: phase2Failed, skippedPkg },
    events, reportSent: null,
  };

  // التقرير يُرسل فقط في المزامنة التلقائية؛ اليدوية تعرض النتيجة في الواجهة بلا رسالة للمدير
  if (notify && office.managerPhone && (acts.length > 0 || events.length > 0 || phase2Imported > 0)) {
    const text = buildReportText(result, start);
    result.reportSent = await sendOrQueueReport(office.id, office.managerPhone.trim(), text);
  }

  return result;
}

// إشعار المدير بتوقف SAS (يُرسل أو يُؤجَّل عبر نفس آلية التقرير)
async function notifySasDown(officeId: number, managerPhone: string | null, officeName: string): Promise<void> {
  if (!managerPhone) return;
  const text = `⚠️ ${officeName}\nفشل الاتصال بنظام SAS، ستتم إعادة المحاولة لاحقاً.`;
  await sendOrQueueReport(officeId, managerPhone.trim(), text);
}

// نص تقرير المزامنة (يتضمّن الأحداث المستحقّة للإبلاغ فقط) — العنوان يختلف بين اليومي واليدوي
function buildReportText(r: SyncResult, day: Date, title = "تقرير المزامنة اليومي"): string {
  const p1 = r.phase1;
  let text = `📋 ${title} — ${r.office}\n`;
  text += `تفعيلات ${formatDate(day)}: ${p1.activations} | كروت البرنامج: ${p1.internal} | خارجي: ${p1.external}\n`;
  text += `تصحيح تواريخ: ${r.phase2.dateFixed} من ${r.phase2.checked} مشترك\n`;
  if (r.phase2.skippedPkg > 0) text += `⏭️ تُركوا بلا تعديل (فئتهم غير مضافة بالبرنامج): ${r.phase2.skippedPkg} مشترك\n`;
  if (r.phase2.imported > 0) text += `🆕 استيراد شامل من الساس: ${r.phase2.imported} مشترك\n`;

  const byScenario = (s: SyncEvent["scenario"]) => r.events.filter((e) => e.scenario === s);
  const s1 = byScenario(1), s3 = byScenario(3), s6 = byScenario(6), s2 = byScenario(2), s7 = byScenario(7);

  // وضع آمن: هذه كروت مشتبه بها لم يتغيّر فيها شيء — تحتاج نظرة منك فقط
  if (s1.length) {
    text += `\n🛡️ كروت مشتبهة (لم يُغيَّر فيها شيء — راجعها يدوياً) (${s1.length}):\n`;
    text += s1.map((e) => `• ${e.subscriber ?? "—"} — بِن ${e.pin ?? "؟"} — ${e.detail ?? ""}`).join("\n");
  }
  if (s3.length) {
    text += `\n🟡 كروت حُدّثت إلى "مستخدم" (${s3.length}):\n`;
    text += s3.map((e) => `• ${e.subscriber ?? "—"} — بِن ${e.pin ?? "؟"}`).join("\n");
  }
  if (s6.length) {
    text += `\n⚠️ تفعيلات بكروت خارجية (${s6.length}):\n`;
    text += s6.map((e) => `• ${e.subscriber ?? "—"} — بِن ${e.pin ?? "؟"}`).join("\n");
  }
  if (s2.length) {
    text += `\n🔁 تفعيلات متكرّرة في SAS (${s2.length}):\n`;
    text += s2.map((e) => `• ${e.subscriber ?? "—"} — ${e.detail ?? ""}`).join("\n");
  }
  if (s7.length) {
    text += `\n🆕 مشتركون جدد استُوردوا تلقائياً (${s7.length}):\n`;
    text += s7.map((e) => `• ${e.subscriber ?? "—"}`).join("\n");
  }
  if (!r.events.length) text += `\n✅ لا توجد ملاحظات تستحق الإبلاغ.`;
  if (r.phase2.failed) text += `\n\n(⚠️ تعذّر إكمال تصحيح التواريخ — تعثّر SAS في المرحلة 2)`;
  return text;
}

// ============================================================================
// المزامنة اليدوية الشاملة (زر «مزامنة الآن»):
//   1) المزامنة المعتادة (مرحلتا الأمس + تصحيح التواريخ).
//   2) فحص كل مخزون الكروت مقابل SAS — بلا تقيّد بيوم:
//      • كارت متاح بالبرنامج ومستخدم في SAS ⇒ يُعلَّم مستخدماً.
//      • كارت مستخدم بالبرنامج (لمشترك هذا المكتب) وغير موجود في SAS ⇒ وهمي
//        (يظهر في «الكروت الوهمية» بحسابات المدير لاتخاذ الإجراء).
//   3) تقرير واتساب كامل للمدير (تقرير المزامنة + نتائج فحص الكروت).
// تعمل بالخلفية وتكتب حالتها أولاً بأول في قاعدة البيانات، والواجهة تستطلعها حتى
// النهاية — فلا «طلب مكرّر» بعد اليوم: الضغطة أثناء التنفيذ تنضمّ للمتابعة نفسها.
// ============================================================================

export interface FullCardsResult {
  checkedAvailable: number; // كروت متاحة فُحصت
  markedUsed: number;       // منها وُجدت مستخدمة في SAS فعُلِّمت
  checkedUsed: number;      // كروت مستخدمة (لمشتركي المكتب) فُحصت
  verifiedReal: number;     // منها مؤكّدة في SAS (سليمة)
  phantom: number;          // منها لم توجد في SAS ⇒ وهمية جديدة
  errors: number;           // كروت تعذّر فحصها (تعثّر SAS) — لم يُحكم عليها
  aborted: boolean;         // أوقف الفحص مبكراً لتكرار تعثّر SAS
  events: SyncEvent[];
  error?: string;
}

// حالة المزامنة اليدوية — في قاعدة البيانات لتصمد عبر النسخ المتعددة وإعادة التشغيل
export type ManualSyncStatus = {
  state: "running" | "done" | "error";
  step?: "sync" | "cards" | "report";
  startedAt: string;
  finishedAt?: string;
  sync?: SyncResult;
  cards?: FullCardsResult | null;
  error?: string;
};

const manualStatusKey = (officeId: number) => `manualSync:${officeId}`;

export async function setManualSyncStatus(officeId: number, st: ManualSyncStatus): Promise<void> {
  const type = manualStatusKey(officeId);
  const text = JSON.stringify(st);
  const row = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true } });
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
}

export async function getManualSyncStatus(officeId: number): Promise<ManualSyncStatus | null> {
  const row = await prisma.systemSetting.findFirst({ where: { type: manualStatusKey(officeId) }, select: { text: true } });
  if (!row?.text) return null;
  try { return JSON.parse(row.text) as ManualSyncStatus; } catch { return null; }
}

// فحص كل مخزون كروت الوكيل مقابل SAS المكتب — بلا نافذة زمنية
export async function runFullCardAudit(officeId: number): Promise<FullCardsResult> {
  const empty: FullCardsResult = {
    checkedAvailable: 0, markedUsed: 0, checkedUsed: 0, verifiedReal: 0,
    phantom: 0, errors: 0, aborted: false, events: [],
  };
  const office = await prisma.tower.findUnique({
    where: { id: officeId },
    select: { id: true, name: true, agentId: true, loginUrl: true, username: true, password: true },
  });
  if (!office?.loginUrl || !office.username || !office.password) {
    return { ...empty, error: "المكتب لا يحتوي بيانات SAS كاملة" };
  }
  let base: string, token: string;
  try {
    base = sasBaseUrl(office.loginUrl);
    token = await sasLogin(base, office.username, office.password);
  } catch (e) {
    return { ...empty, error: (e as Error).message || "فشل الاتصال بـ SAS" };
  }

  const agentId = office.agentId ?? -1;
  const cards = await prisma.rechargeCard.findMany({
    where: { agentId },
    select: { id: true, serial: true, useDate: true, subscriberId: true },
    orderBy: { id: "asc" },
  });

  // مشتركو هذا المكتب (نطاق حكم «الوهمي»): كارت مكتبٍ آخر يُفحص عند مزامنة مكتبه —
  // حساب SAS لكل مكتب قد لا يرى تفعيلات غيره، فالحكم عبر حسابٍ آخر إيجابٌ كاذب
  const officeSubs = await prisma.subscriber.findMany({
    where: { isDeleted: false, towerId: officeId },
    select: { id: true, name: true, netUser: true },
  });
  const officeSubById = new Map(officeSubs.map((s) => [s.id, s]));

  // الوهمية المُعلَّمة سابقاً (ما زالت معلّقة) — لا تُعلَّم مرتين
  const since = new Date(Date.now() - 120 * 86400 * 1000);
  const flagged = new Set(
    (await prisma.auditLog.findMany({
      where: { action: "SYNC_PHANTOM_VERIFIED", createdAt: { gte: since } },
      select: { entityId: true },
    })).map((a) => Number(a.entityId)).filter((n) => Number.isFinite(n)),
  );

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const res: FullCardsResult = { ...empty };

  // بحث صارم مع محاولة ثانية — فشل البحث لا يُحسب حكماً (لا «وهمي» بسبب انقطاع)
  async function search(serial: string): Promise<SasActivation | null | "err"> {
    try { return await sasSearchActivationStrict(base, token, serial); }
    catch { /* محاولة ثانية بعد مهلة */ }
    await sleep(1800);
    try { return await sasSearchActivationStrict(base, token, serial); }
    catch { return "err"; }
  }

  for (const c of cards) {
    const serial = (c.serial ?? "").trim();
    if (!serial) continue;

    if (c.useDate == null) {
      // متاح بالبرنامج: هل استُخدم في SAS؟
      res.checkedAvailable++;
      const a = await search(serial);
      if (a === "err") { res.errors++; }
      else if (a) {
        const when = a.createdAt ? new Date(a.createdAt) : new Date();
        // ربط المشترك إن عُرف من تفعيل SAS
        const sub = a.sasUserId
          ? await prisma.subscriber.findFirst({ where: { sasId: a.sasUserId, isDeleted: false }, select: { id: true, name: true, netUser: true } })
          : null;
        await prisma.rechargeCard.update({
          where: { id: c.id },
          data: { useDate: isNaN(when.getTime()) ? new Date() : when, subscriberId: sub?.id ?? null, userName: "sync", reservedBy: null, reservedAt: null },
        });
        res.markedUsed++;
        res.events.push({ scenario: 3, subscriber: sub?.name ?? sub?.netUser ?? null, pin: serial, detail: "فحص شامل: الكارت مستخدم في SAS — حُدّث إلى مستخدم" });
      }
    } else {
      // مستخدم بالبرنامج: يُحكم عليه فقط إن كان لمشترك هذا المكتب ولم يُعلَّم وهمياً سابقاً
      if (c.subscriberId == null) continue;
      const sub = officeSubById.get(c.subscriberId);
      if (!sub || flagged.has(c.id)) continue;
      res.checkedUsed++;
      const a = await search(serial);
      if (a === "err") { res.errors++; }
      else if (a) { res.verifiedReal++; }
      else {
        await prisma.auditLog.create({
          data: {
            action: "SYNC_PHANTOM_VERIFIED", entity: "rechargeCard", entityId: String(c.id),
            details: `كارت وهمي (فحص شامل ببحث SAS): سيريال ${serial} — مشترك ${sub.name ?? sub.netUser ?? c.subscriberId} — مكتب ${office.name ?? officeId} — استُخدم ${c.useDate ? new Date(c.useDate).toISOString() : "؟"}`,
          },
        });
        flagged.add(c.id);
        res.phantom++;
        res.events.push({ scenario: 1, subscriber: sub.name ?? sub.netUser ?? null, pin: serial, detail: "فحص شامل: مستخدم بالبرنامج بلا تفعيل في SAS — أُدرج بالكروت الوهمية" });
      }
    }

    // تعثّر متكرّر ⇒ SAS متوقف: نوقف الفحص كي لا نطيل بلا جدوى (يُعاد لاحقاً)
    if (res.errors >= 10) { res.aborted = true; break; }
    await sleep(350); // فاصل بين استعلامات SAS لتفادي الحظر
  }

  await prisma.auditLog.create({
    data: {
      action: "SYNC_FULL_CARDS", entity: "tower", entityId: String(officeId),
      details: `فحص شامل للكروت — ${office.name ?? officeId}: متاح ${res.checkedAvailable} (حُدّث ${res.markedUsed}) · مستخدم ${res.checkedUsed} (سليم ${res.verifiedReal} · وهمي ${res.phantom})` +
        (res.errors ? ` · تعذّر فحص ${res.errors}` : "") + (res.aborted ? " · أُوقف مبكراً لتعثّر SAS" : ""),
    },
  });
  return res;
}

// نصّ تقرير المزامنة اليدوية الكامل: تقرير المزامنة + قسم فحص الكروت
function buildManualReportText(sync: SyncResult, cards: FullCardsResult | null): string {
  const day = iraqYesterdayRange(new Date()).start;
  let text = buildReportText(sync, day, "تقرير المزامنة اليدوية");
  if (cards) {
    text += `\n\n📇 فحص الكروت الشامل (كل المخزون):\n`;
    if (cards.error) {
      text += `⚠️ تعذّر الفحص: ${cards.error}`;
    } else {
      text += `متاح فُحص: ${cards.checkedAvailable} — حُدّث إلى مستخدم: ${cards.markedUsed}\n`;
      text += `مستخدم فُحص: ${cards.checkedUsed} — سليم: ${cards.verifiedReal} — وهمي جديد: ${cards.phantom}`;
      if (cards.phantom > 0) text += `\n🛡️ الوهمية تظهر في «الكروت الوهمية» بحسابات المدير لاتخاذ الإجراء.`;
      if (cards.errors > 0) text += `\n⚠️ تعذّر فحص ${cards.errors} كارت (تعثّر SAS)${cards.aborted ? " — أُوقف الفحص مبكراً" : ""}.`;
      const list = cards.events.slice(0, 20);
      if (list.length) {
        text += `\n` + list.map((e) => `• ${e.scenario === 3 ? "🟡" : "🔴"} بِن ${e.pin ?? "؟"} — ${e.subscriber ?? "—"}`).join("\n");
        if (cards.events.length > list.length) text += `\n… و${cards.events.length - list.length} أخرى`;
      }
    }
  }
  return text;
}

// المنسّق الخلفي للمزامنة اليدوية — يُستدعى بلا انتظار من مسار الزر، والواجهة تستطلع الحالة
export async function runManualSync(officeId: number): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    await setManualSyncStatus(officeId, { state: "running", step: "sync", startedAt });

    // إن صادفت مزامنةً مجدولةً جارية (قفل داخلي): ننتظر وندخل بعدها بدل رسالة «الطلب المكرّر»
    let sync = await runOfficeSync(officeId, { notify: false });
    for (let i = 0; i < 5 && sync.error?.includes("قيد التنفيذ"); i++) {
      await new Promise((r) => setTimeout(r, 25_000));
      sync = await runOfficeSync(officeId, { notify: false });
    }

    if (sync.error) {
      await setManualSyncStatus(officeId, { state: "done", startedAt, finishedAt: new Date().toISOString(), sync, cards: null });
      return;
    }

    await setManualSyncStatus(officeId, { state: "running", step: "cards", startedAt, sync });
    let cards: FullCardsResult;
    try { cards = await runFullCardAudit(officeId); }
    catch (e) {
      cards = {
        checkedAvailable: 0, markedUsed: 0, checkedUsed: 0, verifiedReal: 0,
        phantom: 0, errors: 0, aborted: false, events: [],
        error: (e as Error).message || "فشل فحص الكروت",
      };
    }

    // تقرير واتساب كامل للمدير — يُؤجَّل تلقائياً إن كان واتساب المكتب مقطوعاً
    await setManualSyncStatus(officeId, { state: "running", step: "report", startedAt, sync, cards });
    const office = await prisma.tower.findUnique({ where: { id: officeId }, select: { managerPhone: true } });
    if (office?.managerPhone?.trim()) {
      sync.reportSent = await sendOrQueueReport(officeId, office.managerPhone.trim(), buildManualReportText(sync, cards));
    }

    await setManualSyncStatus(officeId, { state: "done", startedAt, finishedAt: new Date().toISOString(), sync, cards });
  } catch (e) {
    await setManualSyncStatus(officeId, {
      state: "error", startedAt, finishedAt: new Date().toISOString(),
      error: (e as Error).message || "فشل غير متوقّع في المزامنة",
    }).catch(() => { /* حتى كتابة الحالة تعذّرت — لا شيء يُفعل */ });
  }
}
