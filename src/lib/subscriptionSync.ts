import { prisma } from "@/lib/prisma";
import {
  sasBaseUrl, sasLogin, sasFetchActivationsForDay, sasFetchAllUsers,
  type SasActivation,
} from "@/lib/sas4";
import { sendViaProvider } from "@/lib/messaging";
import { formatDate } from "@/lib/format";
import { iraqYesterdayRange } from "@/lib/dailyReport";

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
  };
  phase2: { checked: number; dateFixed: number; imported: number; failed: boolean };
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

// هل يختلف التاريخان في اليوم التقويمي؟ (نتجاهل فروق الساعات)
function calendarDiffers(a: Date | null | undefined, b: Date): boolean {
  if (!a) return true;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return da !== db;
}

// تفعيل بكارت (voucher)؟ الكارت في حقل pin؛ نستبعد التفعيل برصيد المستخدم
function isCardActivation(a: SasActivation): boolean {
  const pin = (a.pin ?? "").trim();
  if (!pin) return false;
  const m = (a.method ?? "").toLowerCase();
  return !/credit/.test(m); // voucher أو غير محدّد = كارت
}

// إرسال تقرير المدير أو حفظه للإرسال لاحقاً عند انقطاع الواتساب.
// يُخزَّن كرسالة PENDING بعلامة sync-report ليعيد المجدول محاولتها.
async function sendOrQueueReport(officeId: number, phone: string, text: string): Promise<boolean> {
  const res = await sendViaProvider("WHATSAPP", phone, text, officeId);
  await prisma.message.create({
    data: {
      channel: "WHATSAPP", phone, text,
      status: res.ok ? "SENT" : "PENDING",
      error: res.ok ? null : (res.error ?? "واتساب غير متصل"),
      createdByUser: "sync-report",
    },
  });
  return res.ok;
}

// تشغيل المزامنة لمكتب واحد (مرحلتان). forDay اختياري لأغراض الاختبار؛ الافتراضي "الأمس".
// notify: يُرسل تقرير المدير فقط في المزامنة التلقائية (المجدول). المزامنة اليدوية (زر «مزامنة الآن») لا تُرسل شيئاً.
export async function runOfficeSync(
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
    phase1: { activations: 0, internal: 0, external: 0, phantom: 0, markedUsed: 0, duplicates: 0, imported: 0 },
    phase2: { checked: 0, dateFixed: 0, imported: 0, failed: false },
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

  // جلب تفعيلات الأمس — عند فشل SAS: إشعار وعدم الانهيار
  let acts: SasActivation[];
  try {
    acts = await sasFetchActivationsForDay(base, token, start, end);
  } catch (e) {
    if (notify) await notifySasDown(office.id, office.managerPhone, officeName);
    return { ...empty, error: (e as Error).message || "فشل جلب تقرير التفعيلات" };
  }

  // ===================== المرحلة 1: كروت وتفعيلات الأمس =====================
  const events: SyncEvent[] = [];
  let internal = 0, external = 0, phantom = 0, markedUsed = 0, duplicates = 0, imported = 0;

  // كل كروت البرنامج (البِن → الكارت)
  const cards = await prisma.rechargeCard.findMany({
    select: { id: true, serial: true, useDate: true, subscriberId: true, price: true },
  });
  const cardBySerial = new Map(cards.map((c) => [(c.serial ?? "").trim(), c]));

  // مشتركو هذا المكتب (بالـ sasId) لمعرفة الجدد ومطابقة الكروت
  const officeSubs = await prisma.subscriber.findMany({
    where: { towerId: officeId, isDeleted: false },
    select: { id: true, sasId: true, name: true, netUser: true },
  });
  const subBySasId = new Map(officeSubs.filter((s) => s.sasId).map((s) => [s.sasId as number, s]));
  const subById = new Map(officeSubs.map((s) => [s.id, s]));

  // مجموعة (مشترك SAS | بِن) لكل تفعيلات الأمس (لكشف التفعيل الوهمي)
  const sasUserPinSet = new Set<string>();
  // تجميع التفعيلات حسب مشترك SAS (لكشف التكرار — السيناريو 2)
  const actsByUser = new Map<number, SasActivation[]>();
  for (const a of acts) {
    const pin = (a.pin ?? "").trim();
    if (pin) sasUserPinSet.add(`${a.sasUserId}|${pin}`);
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
  //   الإجراء: إرجاع الكارت غير مستخدم + خصم سعره من ديون الكارتات (تصفير price) + إبلاغ.
  const usedYesterday = cards.filter(
    (c) => c.useDate && c.subscriberId != null && withinRange(c.useDate, start, end) && subById.has(c.subscriberId),
  );
  for (const c of usedYesterday) {
    const sub = subById.get(c.subscriberId!);
    if (!sub?.sasId) continue;
    const key = `${sub.sasId}|${(c.serial ?? "").trim()}`;
    if (sasUserPinSet.has(key)) continue; // للكارت تفعيل فعلي في SAS → سليم

    const originalPrice = c.price ?? 0;
    await prisma.$transaction([
      // إرجاع الكارت للمخزون كغير مستخدم + تصفير سعره (خصم قيمته من ديون الكارتات)
      prisma.rechargeCard.update({
        where: { id: c.id },
        data: { useDate: null, subscriberId: null, userName: null, reservedBy: null, reservedAt: null, price: 0 },
      }),
      prisma.auditLog.create({
        data: {
          action: "SYNC_PHANTOM_CARD", entity: "rechargeCard", entityId: String(c.id),
          details: `تفعيل وهمي (${officeName}) — إرجاع كارت ${c.serial} للمخزن وخصم ${originalPrice} من ديون الكارتات`,
        },
      }),
    ]);
    phantom++;
    events.push({
      scenario: 1, subscriber: sub.name ?? sub.netUser, pin: c.serial,
      detail: `إرجاع الكارت وخصم ${originalPrice} من ديون الكارتات`,
    });
  }

  // ===================== المرحلة 2: كل مشتركي المكتب في الساس =====================
  // تجلب كل مشتركي الساس (500/صفحة مع تأخير)، فتقوم بأمرين:
  //  (أ) استيراد كل مشترك موجود في الساس وغير موجود في البرنامج (استيراد شامل — السيناريو 7 لكامل القاعدة).
  //  (ب) تصحيح تاريخ الانتهاء بصمت للمشتركين الموجودين عند اختلافه (السيناريوهان 4 و5).
  let checked = 0, dateFixed = 0, phase2Imported = 0, phase2Failed = false;
  try {
    const allUsers = await sasFetchAllUsers(base, token);
    const progSubs = await prisma.subscriber.findMany({
      where: { towerId: officeId, isDeleted: false, sasId: { not: null } },
      select: { id: true, sasId: true, dateTo: true },
    });
    const progBySasId = new Map(progSubs.map((s) => [s.sasId as number, s]));

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
      // موجود → تصحيح التاريخ بصمت عند الاختلاف
      checked++;
      if (validDate && calendarDiffers(p.dateTo, validDate)) {
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
    phase1: { activations: acts.length, internal, external, phantom, markedUsed, duplicates, imported },
    phase2: { checked, dateFixed, imported: phase2Imported, failed: phase2Failed },
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

// نص تقرير المزامنة اليومي (يتضمّن الأحداث المستحقّة للإبلاغ فقط)
function buildReportText(r: SyncResult, day: Date): string {
  const p1 = r.phase1;
  let text = `📋 تقرير المزامنة اليومي — ${r.office}\n`;
  text += `تفعيلات ${formatDate(day)}: ${p1.activations} | كروت البرنامج: ${p1.internal} | خارجي: ${p1.external}\n`;
  text += `تصحيح تواريخ: ${r.phase2.dateFixed} من ${r.phase2.checked} مشترك\n`;
  if (r.phase2.imported > 0) text += `🆕 استيراد شامل من الساس: ${r.phase2.imported} مشترك\n`;

  const byScenario = (s: SyncEvent["scenario"]) => r.events.filter((e) => e.scenario === s);
  const s1 = byScenario(1), s3 = byScenario(3), s6 = byScenario(6), s2 = byScenario(2), s7 = byScenario(7);

  if (s1.length) {
    text += `\n🔴 تفعيلات وهمية أُرجعت كروتها (${s1.length}):\n`;
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
