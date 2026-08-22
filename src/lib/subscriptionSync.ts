import { prisma } from "@/lib/prisma";
import {
  sasBaseUrl, sasLogin, sasFetchActivationsForDay, sasFetchAllUsers,
  sasProbeSerial, sasUserActivations,
  sasFetchActivationsSince, sasWindowBound,
  type SasActivation,
} from "@/lib/sas4";
import { sendViaProvider } from "@/lib/messaging";
import { formatDate } from "@/lib/format";
import { iraqYesterdayRange, iraqTodayRange } from "@/lib/dailyReport";
import { matcherForOffice } from "@/lib/packageMatch";
import { credsOfPanel, credsOfTower, panelsOfTower, credsFromPanel, type SasCreds } from "@/lib/sasPanel";
// 📋 سجلّ المزامنة (2026-08-20): المزامنةُ ترصد وتكتب في السجلّ، والتطبيقُ بيد صاحب الصلاحيّة
import { recordInfoDiff, recordInstall, recordActivationEvent, recordCompanyActivation, resolveEventIfReceipted, reconcileInstalls, reconcileInfo, reconcileEvents, reconcileStolenCards, closeDeadSasRows, recordExternalCardCase, recordStolenCardCase, isOwnCabinet, isOfferPackage, type InfoChange, type EventOutcome } from "@/lib/syncLog";
import { getSyncAutoMsgFlags, sendSyncLogMessage } from "@/lib/syncAutoMsg";

// ═════ ✍️ اسمٌ عندنا يحمل ملاحظةً فوق اسم الساس (مراجعةُ محمد 2026-08-21) ═════
// ٢٩ صفّاً في حسابه كان اسمُنا فيها اسمَ الساس **زائداً ملاحظةً تشغيليّة** («… تحويل
// لا تفعل»)، فيُرصَد فرقٌ تطبيقُه **يمحو ملاحظتَه**. فما دام اسمُنا يحتوي اسمَ الساس
// كاملاً فهو الأغنى ولم يأتِ الساسُ بجديدٍ ⇒ لا فرق.
// ═════ 🕗 سماحيةُ ١٢ ساعة على تاريخ الانتهاء (قياسٌ حيّ 2026-08-21) ═════
// الساسُ ينهي الاشتراك **17:00Z** (٢٠:٠٠ بغداد) والبرنامجُ يخزّن **00:00Z**، والمقارنةُ
// كانت بيوم الـISO ⇒ فرقُ يومٍ **كاذبٌ لكلّ من جاء تاريخُه من عرفٍ مختلف**. وقِيس على
// حساب محمد: **١٤ من ٣٣** صفَّ تاريخٍ كانت فرقاً مقدارُه **٧ ساعاتٍ بالضبط** لا غير.
// و١٢ ساعةً تفصل الوهمَ عن الحقيقة: تمديدُ يومٍ حقيقيٍّ فرقُه ١٧ ساعةً فيبقى ظاهراً.
const EXP_TOL_MS = 12 * 3600_000;
const sameExpiry = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  !!a && !!b && Math.abs(a.getTime() - b.getTime()) <= EXP_TOL_MS;

// 💰 نافذةُ «مقبوضٌ عندي» حول لحظة التفعيل — ٣٦ ساعةً تغطّي وصلاً كُتب صباحَ اليوم التالي
const RECEIPT_NEAR_MS = 36 * 3600_000;

const nameKey = (x: string | null | undefined) =>
  String(x ?? "").replace(/[\s.,\-_()·،]+/g, " ").trim().toLowerCase();
function nameCoversSas(ours: string | null | undefined, sas: string | null | undefined): boolean {
  const o = nameKey(ours), sn = nameKey(sas);
  return !!o && !!sn && o.includes(sn);
}

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
    phantom: number; markedUsed: number; duplicates: number; imported: number; dupUserPhase1?: number;
    verifiedReal: number; // كروت مُستخدمة أمس أُكّد تفعيلها في SAS ببحث مباشر (ليست وهمية)
  };
  // البند ٥ · `dupUserSkipped`: مشتركٌ في الساس **يوزرُه موجودٌ عندنا بصفٍّ آخر** فلم
  //   يُستورَد — يُبلَّغ ولا يُسكَت عنه، فالصمتُ يُخفي حالةً تحتاج قرارَ محمد.
  phase2: { checked: number; dateFixed: number; imported: number; failed: boolean; skippedPkg: number; pkgFixed: number; dupUserSkipped?: number;
    // 🎯 كم قفزةَ تاريخٍ لم تُصنَّف لأنّ سقفَ السؤال المباشر بلغ حدَّه — **يُعلَن ولا يُبتلَع**
    probesCapped?: number; stolenCards?: number };
  events: SyncEvent[];
  reportSent: boolean | null; // true=أُرسل، false=مؤجّل (واتساب مقطوع)، null=لا تقرير
  error?: string;
  // ═════ سؤالُ محمد 2026-08-13: «كيف أتأكّد أنّها مرّت على الساسَين؟» ═════
  // كانت نتائجُ اللوحات **تُجمَع في رقمٍ واحد** ويُنزَع اسمُ اللوحة، فالنجاحُ صامتٌ
  // تماماً: لا شيءَ يقول «مرّت على اثنتَين» ولا يُميّز «١٢ تفعيلاً من الأولى وصفرٌ من
  // الثانية» عن «١٢ من الأولى واللوحةُ الثانيةُ لم تُمَسّ». والأخطاءُ وحدَها كانت تظهر.
  // ⇒ سطرٌ لكلّ لوحةٍ باسمها ونتيجتها — يُعرَض في الشاشة ويُذكَر في تقرير الواتساب.
  panels?: PanelSyncLine[];
}

/** نتيجةُ لوحةِ ساسٍ واحدةٍ داخل مزامنةِ مكتب. `panelId: null` = أعمدةُ المكتب (بلا لوحات). */
export interface PanelSyncLine {
  panelId: number | null;
  label: string;      // اسمُ اللوحة كما يراه المدير (أو «المكتب» لمن لا لوحةَ له)
  ok: boolean;        // مرّت بلا خطأ
  activations: number;
  imported: number;   // مستوردون (المرحلتان معاً)
  checked: number;    // فُحصت تواريخهم في المرحلة الثانية
  dateFixed: number;
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
  // عزل: تُوسَم بوكيل المكتب — سجلّ الرسائل يُرشَّح بالوكيل لا باسم المُنشئ (تدقيق 2026-08-09)
  const tw = await prisma.tower.findUnique({ where: { id: officeId }, select: { agentId: true } });
  await prisma.message.create({
    data: {
      channel: "WHATSAPP", phone, text,
      status: res.ok ? "SENT" : "FAILED",
      error: res.ok ? null : (res.error ?? "واتساب غير متصل"),
      createdByUser: "sync-report",
      agentId: tw?.agentId ?? null,
    },
  });
  return res.ok;
}

// ═════ 🔗 دمجُ المكرَّرين على اليوزر نفسِه — إذنُ محمد الصريح 2026-08-21 ═════
// «التطابقُ يُحدَّد على أساس اليوزر فقط ويجب إزالةُ التكرار» (وأذِن بلا عرضِ قائمة).
// نشأ التكرارُ من بابَين أُغلقا اليوم: الاستيرادُ التلقائيُّ القديم حين تُعيد الشركةُ إنشاءَ
// حساب الساس برقمٍ جديد، و«استبدالُ مشترك» الذي كان ينسخ **الرقمَ الميت** للصفّ الجديد.
// والقاعدة: **يبقى صاحبُ المال** (وصولاتٌ ⇐ قرضٌ ⇐ باقةٌ ⇐ الأقدم)، ويرث رقمَ الساس الحيَّ
// (الأكبر) وأبعدَ تاريخِ انتهاءٍ وما ينقصه من باقةٍ/هاتفٍ/عنوان، وتنتقل إليه كروتُ الآخر.
// 🛡️ ومجموعةٌ فيها **مالٌ في صفَّين** لا تُمَسّ إطلاقاً — تبقى لقرار محمد.
export type MergeReport = { groups: number; merged: number; skippedMoney: number; errors: string[] };
export async function mergeDuplicateNetUsers(officeId: number): Promise<MergeReport> {
  const report: MergeReport = { groups: 0, merged: 0, skippedMoney: 0, errors: [] };
  try {
    const rows = await prisma.subscriber.findMany({
      where: { towerId: officeId, isDeleted: false, netUser: { not: null } },
      select: { id: true, netUser: true, sasId: true, dateTo: true, packageId: true, address: true, phone: true, note: true, name: true },
    });
    const byUser = new Map<string, typeof rows>();
    for (const r of rows) {
      const u = (r.netUser ?? "").trim().toLowerCase();
      if (!u || u.includes("#")) continue; // الأرشيفُ الموسومُ (#سابق/#مدموج) خارج المقارنة
      const l = byUser.get(u) ?? []; l.push(r); byUser.set(u, l);
    }
    for (const [ukey, group] of byUser) {
      if (group.length < 2) continue;
      report.groups++;
      const ids = group.map((g) => g.id);
      const [entries, loans, cards] = await Promise.all([
        prisma.subscriptionEntry.findMany({ where: { subscriberId: { in: ids }, isDeleted: false }, select: { subscriberId: true } }),
        prisma.loanDebt.findMany({ where: { subscriberId: { in: ids }, isDeleted: false }, select: { subscriberId: true } }),
        prisma.rechargeCard.findMany({ where: { subscriberId: { in: ids } }, select: { id: true, subscriberId: true } }),
      ]);
      const money = new Set<number>();
      for (const e of entries) if (e.subscriberId != null) money.add(e.subscriberId);
      for (const l of loans) money.add(l.subscriberId);
      if (money.size > 1) { report.skippedMoney++; continue; } // 🛡️ مالٌ في صفَّين ⇒ لا تُمَسّ
      const keeper = group.find((g) => money.has(g.id))
        ?? group.find((g) => g.packageId != null)
        ?? group.slice().sort((a, b) => a.id - b.id)[0];
      const others = group.filter((g) => g.id !== keeper.id);
      if (!others.length) continue;
      const bestSas = group.reduce<number | null>((m, g) => (g.sasId != null && (m == null || g.sasId > m) ? g.sasId : m), null);
      const bestDate = group.reduce<Date | null>((m, g) => (g.dateTo && (!m || g.dateTo > m) ? g.dateTo : m), null);
      const fill = <T,>(pick: (g: (typeof group)[number]) => T | null | undefined): T | null => {
        for (const g of group) { const v = pick(g); if (v != null && String(v).trim() !== "") return v; }
        return null;
      };
      const stamp = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
      try {
      await prisma.$transaction(async (tx) => {
        const moving = cards.filter((c) => c.subscriberId != null && c.subscriberId !== keeper.id).map((c) => c.id);
        if (moving.length) await tx.rechargeCard.updateMany({ where: { id: { in: moving } }, data: { subscriberId: keeper.id } });
        // 🔴 **الترتيبُ شرطُ نجاحٍ لا تفصيل** (قِيس على الإنتاج 2026-08-21): على المشتركين
        //    فهرسٌ فريدٌ (towerId, sasId). فتحديثُ الباقي إلى الرقم الحيِّ **قبل** تفريغه من
        //    الصفّ المكرَّر يرتطم بالفهرس ⇒ سقطت ٢٥ مجموعةً من ٢٦ صامتةً. فيُفرَّغ المكرَّرُ
        //    أوّلاً (isDeleted + sasId=null + وسمُ اليوزر) ثمّ يرث الباقي.
        for (const o of others) {
          await tx.subscriber.update({
            where: { id: o.id },
            data: {
              isDeleted: true, sasId: null, state: "مدموج",
              netUser: `${(o.netUser ?? "").trim()}#مدموج-${stamp}`,
              note: `${o.note ? `${o.note}
` : ""}[دمج ${stamp}] صفٌّ مكرَّرٌ لليوزر نفسِه — دُمج في #${keeper.id}`,
            },
          });
          await tx.syncLog.updateMany({
            where: { subscriberId: o.id, status: { in: ["pending", "ignored"] } },
            data: { status: "done", note: "دُمج المشتركُ المكرَّر — أُغلق تلقائيّاً", handledAt: new Date() },
          }).catch(() => {});
          await tx.auditLog.create({
            data: {
              action: "MERGE_DUP_NETUSER", entity: "subscriber", entityId: String(o.id),
              details: `دمجُ مكرَّرٍ على اليوزر «${ukey}»: #${o.id} ⇐ #${keeper.id} (رقمُ الساس ${bestSas ?? "—"}، مكتب #${officeId})`,
            },
          }).catch(() => {});
          report.merged++;
        }
        await tx.subscriber.update({
          where: { id: keeper.id },
          data: {
            sasId: bestSas ?? keeper.sasId,
            ...(bestDate && (!keeper.dateTo || bestDate > keeper.dateTo) ? { dateTo: bestDate } : {}),
            ...(keeper.packageId == null ? { packageId: fill((g) => g.packageId) } : {}),
            ...(!(keeper.phone ?? "").trim() ? { phone: fill((g) => g.phone) } : {}),
            ...(!(keeper.address ?? "").trim() ? { address: fill((g) => g.address) } : {}),
            note: `${keeper.note ? `${keeper.note}
` : ""}[دمج ${stamp}] ورث رقمَ الساس ${bestSas ?? "—"} من صفٍّ مكرَّرٍ لليوزر نفسِه`,
          },
        });
      }, { timeout: 20_000 });
      } catch (e) {
        // 🔴 عطلُ مجموعةٍ واحدةٍ كان يُجهض الحلقةَ كلَّها بصمت (فيبدو أنّ «لا شيء تغيّر»)
        report.errors.push(`${ukey}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }
    }
    if (report.merged || report.errors.length) {
      console.log(`[sync] 🔗 مكتب ${officeId}: مجموعاتٌ ${report.groups} · دُمج ${report.merged} · تُركت لمالٍ مزدوج ${report.skippedMoney} · أعطال ${report.errors.length}`);
      for (const er of report.errors.slice(0, 5)) console.error("[sync] عطلُ دمج:", er);
    }
    return report;
  } catch (e) {
    report.errors.push(e instanceof Error ? e.message : String(e));
    console.error("[sync] تعذّر دمجُ المكرَّرين:", e instanceof Error ? e.message : e);
    return report;
  }
}
// قفل تزامن: يمنع تشغيل مزامنتين لنفس المكتب في آن واحد. كان الضغط المتكرّر على
// «مزامنة الآن» يُشغّل نسخاً متوازية تقرأ الحالة نفسها فتُكرّر المعالجة والإرجاع.
const syncRunning = new Set<number>();

// ===== أ-٢٣ · المدخلُ الصحيح: مزامنةُ المكتب **بكلّ لوحاته** =====
// مكتبٌ بلوحتَي ساس = حسابان مختلفان على مُخدِّم(ات) الساس، ولكلٍّ مشتركوه. فمزامنةٌ واحدةٌ
// بحساب اللوحة الأولى **لا تجد مشتركي الثانية** فتُسيء تفسيرَهم. ⇒ تُشغَّل مرّةً لكلّ لوحة،
// وكلُّ دورةٍ مقصورةٌ على مشتركي لوحتها (`panelWhere` في `runOfficeSyncInner`).
//
// 🔑 ومكتبٌ بلوحةٍ واحدةٍ (أو بلا لوحاتٍ) يمرّ بالمسار القديم حرفيّاً — بلا `panelId` ولا تقييد
//    ⇒ **صفرُ تغييرٍ في سلوك المكاتب التسعة الأخرى.**
export async function runOfficeSyncAll(
  officeId: number,
  opts: { forDay?: Date; notify?: boolean } = {},
): Promise<SyncResult> {
  const { panelsOfTower } = await import("@/lib/sasPanel");
  const panels = await panelsOfTower(officeId);
  if (panels.length <= 1) {
    // المسارُ القديم بالضبط — ويُوسَم بسطرِ لوحةٍ واحدةٍ ليكون العرضُ موحَّداً، فيُرى
    // صريحاً «لوحةٌ واحدة» ولا يُظنّ أنّ الثانيةَ سقطت من التقرير.
    const one = await runOfficeSync(officeId, opts);
    const p = panels[0];
    return {
      ...one,
      panels: [{
        panelId: p?.id ?? null,
        label: p?.label ?? one.office.split(" · ")[1] ?? "المكتب",
        ok: !one.error,
        activations: one.phase1.activations,
        imported: one.phase1.imported + one.phase2.imported,
        checked: one.phase2.checked, dateFixed: one.phase2.dateFixed,
        ...(one.error ? { error: one.error } : {}),
      }],
    };
  }

  const parts: SyncResult[] = [];
  for (const p of panels) {
    // متتابعٌ لا متوازٍ: الساسُ حسابٌ واحدٌ لكلّ لوحةٍ لكنّ المُخدِّمَ قد يكون واحداً، والتوازي
    // يُثقله؛ والأهمُّ أنّ سجلَّ الأحداث يبقى مرتَّباً ومفهوماً للمدير.
    parts.push(await runOfficeSync(officeId, { ...opts, panelId: p.id }));
  }
  // تُجمَع النتائجُ في تقريرٍ واحدٍ — فالمكتبُ واحدٌ عند المدير وإن كانت لوحاتُه اثنتَين
  const sum = (f: (r: SyncResult) => number) => parts.reduce((a, r) => a + f(r), 0);
  return {
    office: parts[0]?.office?.split(" · ")[0] ?? "المكتب",
    phase1: {
      activations: sum((r) => r.phase1.activations), internal: sum((r) => r.phase1.internal),
      external: sum((r) => r.phase1.external), phantom: sum((r) => r.phase1.phantom),
      markedUsed: sum((r) => r.phase1.markedUsed), duplicates: sum((r) => r.phase1.duplicates),
      imported: sum((r) => r.phase1.imported), verifiedReal: sum((r) => r.phase1.verifiedReal),
      dupUserPhase1: sum((r) => r.phase1.dupUserPhase1 ?? 0),
    },
    phase2: {
      checked: sum((r) => r.phase2.checked), dateFixed: sum((r) => r.phase2.dateFixed),
      imported: sum((r) => r.phase2.imported), failed: parts.some((r) => r.phase2.failed),
      skippedPkg: sum((r) => r.phase2.skippedPkg), pkgFixed: sum((r) => r.phase2.pkgFixed),
      // 🧮 وعدّادا الطبقة الثانية يُجمَعان كغيرهما — فمكتبٌ بلوحتَين يرى المجموعَ لا نصفَه
      probesCapped: sum((r) => r.phase2.probesCapped ?? 0), stolenCards: sum((r) => r.phase2.stolenCards ?? 0),
    },
    // سطرٌ لكلّ لوحةٍ باسمها — الجوابُ على «هل مرّت على الساسَين؟»
    panels: parts.map((r, i) => ({
      panelId: panels[i]?.id ?? null,
      label: panels[i]?.label ?? r.office.split(" · ")[1] ?? `لوحة ${i + 1}`,
      ok: !r.error,
      activations: r.phase1.activations,
      imported: r.phase1.imported + r.phase2.imported,
      checked: r.phase2.checked, dateFixed: r.phase2.dateFixed,
      ...(r.error ? { error: r.error } : {}),
    })),
    events: parts.flatMap((r) => r.events),
    reportSent: parts.some((r) => r.reportSent === true) ? true : (parts.some((r) => r.reportSent === false) ? false : null),
    // خطأُ لوحةٍ لا يُخفي نجاحَ الأخرى: تُذكَر الأخطاءُ مجموعةً باسم لوحتها
    error: parts.filter((r) => r.error).map((r) => `${r.office}: ${r.error}`).join(" | ") || undefined,
  };
}

// تشغيل المزامنة لمكتب واحد (مرحلتان). forDay اختياري لأغراض الاختبار؛ الافتراضي "الأمس".
// notify: يُرسل تقرير المدير فقط في المزامنة التلقائية (المجدول). المزامنة اليدوية (زر «مزامنة الآن») لا تُرسل شيئاً.
export async function runOfficeSync(
  officeId: number,
  // أ-٢٣ · `panelId` = مزامنةُ **لوحةِ ساسٍ** بعينها من لوحات المكتب. فارغٌ = السلوكُ القديم
  // (أعمدةُ المكتب أو لوحتُه الأولى)، وحينها يُعالَج كلُّ مشتركي المكتب كما كان تماماً.
  opts: { forDay?: Date; notify?: boolean; panelId?: number | null } = {},
): Promise<SyncResult> {
  // 🔒 المفتاحُ يحمل اللوحةَ: بلا ذلك تُحجب مزامنةُ اللوحة الثانية بقفل الأولى فتبقى بلا مزامنة
  const lockKey = opts.panelId != null ? officeId * 1000000 + opts.panelId : officeId;
  if (syncRunning.has(lockKey)) {
    return {
      office: "المكتب",
      phase1: { activations: 0, internal: 0, external: 0, phantom: 0, markedUsed: 0, duplicates: 0, imported: 0, verifiedReal: 0, dupUserPhase1: 0 },
      phase2: { checked: 0, dateFixed: 0, imported: 0, failed: false, skippedPkg: 0, pkgFixed: 0 },
      events: [], reportSent: null,
      error: "مزامنة هذا المكتب قيد التنفيذ بالفعل — تم تجاهل الطلب المكرّر",
    };
  }
  syncRunning.add(lockKey);
  try {
    return await runOfficeSyncInner(officeId, opts);
  } finally {
    syncRunning.delete(lockKey);
  }
}

async function runOfficeSyncInner(
  officeId: number,
  { forDay, notify = true, panelId = null }: { forDay?: Date; notify?: boolean; panelId?: number | null } = {},
): Promise<SyncResult> {
  const office = await prisma.tower.findUnique({
    where: { id: officeId },
    select: { id: true, name: true, agentId: true, managerPhone: true },
  });
  // أ-٢٣ · بياناتُ الساس من اللوحة المطلوبة، وإلّا لوحةُ المكتب الأولى، وإلّا أعمدتُه (السلوكُ القديم)
  const creds = panelId != null ? await credsOfPanel(panelId) : await credsOfTower(officeId);
  // 🔴 نطاقُ اللوحة: عند مزامنة لوحةٍ بعينها **لا تُلمَس صفوفُ لوحةٍ أخرى في المكتب نفسِه**؛
  // وبلا لوحةٍ يبقى النطاقُ فارغاً فيُعالَج كلُّ مشتركي المكتب كما كان قبل البند حرفيّاً.
  const panelWhere = panelId != null ? { sasPanelId: panelId } : {};
  const officeName = (panelId != null && creds?.label ? `${office?.name ?? "المكتب"} · ${creds.label}` : office?.name) ?? "المكتب";
  const empty: SyncResult = {
    office: officeName,
    phase1: { activations: 0, internal: 0, external: 0, phantom: 0, markedUsed: 0, duplicates: 0, imported: 0, verifiedReal: 0, dupUserPhase1: 0 },
    phase2: { checked: 0, dateFixed: 0, imported: 0, failed: false, skippedPkg: 0, pkgFixed: 0 },
    events: [], reportSent: null,
  };

  if (!office || !creds) {
    return { ...empty, error: panelId != null ? "لوحةُ الساس لا تحتوي بيانات كاملة" : "المكتب لا يحتوي بيانات SAS كاملة" };
  }

  // نطاق "الأمس" بتوقيت العراق
  const { start, end } = iraqYesterdayRange(forDay ?? new Date());
  const officeUser = creds.username.trim().toLowerCase();

  // تسجيل الدخول — عند فشل SAS: إشعار المدير وعدم الانهيار
  let base: string, token: string;
  try {
    base = sasBaseUrl(creds.loginUrl);
    token = await sasLogin(base, creds.username, creds.password);
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
  // ⏱️ الحدودُ تُزاح ٣ ساعاتٍ لتطابق أرقامَ الساس (شرحُها عند `sasWindowBound`): بلا ذلك
  //    كانت نافذةُ «أمس» تنتهي ٢١:٠٠ بغداد فتسقط تفعيلاتُ الليل من كلّ السيناريوهات.
  const actsLo = sasWindowBound(start), actsHi = sasWindowBound(end);
  const acts = actsWide.filter((a) => {
    const d = a.createdAt ? new Date(a.createdAt) : null;
    return d != null && !isNaN(d.getTime()) && d >= actsLo && d <= actsHi;
  });

  // 📋 جيك بوكسا «إرسال رسائل تلقائي» لتبويبَي سجلّ المزامنة (طلب محمد 2026-08-20) —
  // يُقرآن مرّةً لكلّ مزامنةٍ، والافتراضيُّ إيقافُ الاثنين (فالإرسال يدويٌّ من النافذة)
  const autoMsg = await getSyncAutoMsgFlags(office.agentId);

  // ♻️ ذاكرةُ هذه الدورة للتصحيح الذاتيّ (شرط محمد 2026-08-21): ما رأيناه فعلاً، وما زال
  // مؤهَّلاً تنصيباً، وما زال مختلفَ المعلومات. ما رأيناه ولم يعد مؤهَّلاً يُغلَق.
  const seenSasIds = new Set<number>();
  const stillInstalls = new Set<number>();
  const stillDiffering = new Set<number>();
  // 🎯 سقفُ المسبار الموجَّه (د): سؤالٌ واحدٌ للساس لكلّ «قفزةِ تاريخٍ» مشكوكٍ فيها.
  // بسقفٍ يحمي المزامنةَ من دورةٍ أولى ضخمةٍ (مكتبٌ جديدٌ بآلاف الفروق).
  let dateProbes = 0;
  let probesCapped = 0;  // قفزاتٌ لم تُصنَّف لبلوغ السقف — تُعلَن في التقرير
  let stolenCards = 0;   // 🔴 كروتُ المخزن التي فُعِّلت بلا وصل
  const MAX_DATE_PROBES = 120;
  // 🗓️ مَن له تفعيلةُ ساسٍ في النافذة (أمس+اليوم) — يُمنَع عنه «فرقُ الأيّام» في تبويب
  // المعلومات لأنّ تبويبَ تفعيلِه هو بيتُه الصحيح (منعُ الازدواج — مراجعة 2026-08-21)
  const actedSasIds = new Set<number>();

  // ===================== المرحلة 1: كروت وتفعيلات الأمس =====================
  const events: SyncEvent[] = [];
  let internal = 0, external = 0, phantom = 0, markedUsed = 0, duplicates = 0;
  const imported = 0; // 📋 الاستيراد التلقائيّ أُلغي (سجلّ المزامنة) — يبقى صفراً للتقرير
  // كم مرّةً منع حارسُ اليوزر إنشاءَ صفٍّ ثانٍ في هذا المسار (يُبلَّغ في تقرير المزامنة)
  let dupUserPhase1 = 0;

  // 🔗 دمجُ المكرَّرين أوّلاً — فكلُّ ما بعده يقرأ صفّاً واحداً لكلّ يوزر (إذنُ محمد)
  await mergeDuplicateNetUsers(officeId);

  // كروت **وكيل هذا المكتب فقط** (البِن → الكارت). كان بلا أي فلتر، والمزامنة تكتب على
  // الكارت المطابق (تستهلكه وتنسبه لمشترك) — أي أن مزامنة وكيل قد تستهلك كارت وكيل آخر
  // بمجرد تشابه السيريال. عزل مالي حرج اصطاده تدقيق 2026-08-02.
  const cards = await prisma.rechargeCard.findMany({
    where: { agentId: office.agentId ?? -1 },
    // 🕵️ `userName`/`reservedBy`: مَن استهلك الكارتَ في البرنامج (بيعاً أو تفعيلاً) —
    //    بهما يُفرَّق **المبيعُ** عن **المسروق**، ويُذكَر الاسمُ في حالة السرقة.
    select: { id: true, serial: true, useDate: true, subscriberId: true, userName: true, reservedBy: true },
  });
  const cardBySerial = new Map(cards.map((c) => [(c.serial ?? "").trim(), c]));

  // مشتركو هذا المكتب (بالـ sasId) لمعرفة الجدد ومطابقة الكروت
  const officeSubs = await prisma.subscriber.findMany({
    where: { towerId: officeId, ...panelWhere, isDeleted: false },
    select: { id: true, sasId: true, name: true, netUser: true, dateTo: true },
  });
  // 💰 أصحابُ القروض — تُستثنى أيّامُهم الوهميّةُ من قاعدة «مغطّى» أدناه
  const loanSubIdsP1 = new Set(
    (await prisma.loanDebt.findMany({ where: { towerId: officeId, isDeleted: false }, select: { subscriberId: true } }))
      .map((r) => r.subscriberId),
  );
  const subBySasId = new Map(officeSubs.filter((s) => s.sasId).map((s) => [s.sasId as number, s]));
  // ═════ 🔴 حرسُ تكرار اليوزر — **للمسار الأوّل أيضاً** (بلاغُ محمد 2026-08-19) ═════
  // للمزامنة **مسارا إنشاء**: هذا (السيناريو ٧ من تفعيلات الأمس) والاستيرادُ الشامل
  // أدناه. والحارسُ كان على الثاني وحدَه ⇒ فبقي هذا يُنشئ صفّاً ثانياً ليوزرٍ موجود.
  // 🎯 وقِيس على الإنتاج (2026-08-19): **٤ صفوفٍ مكرّرةٍ أنشأتها المزامنةُ يوم ٠٨-١٥**،
  //    أي **بعد** نشر الحارس على المسار الثاني — وهو الدليلُ القاطع على ثغرة المسار الأوّل.
  // وحالةُ محمد بنصّها: يستورد اليوزر (١٠ أيّام)، ويُفعّله يدويّاً ٥٠ يوماً (⇒ ٦٠)، ثمّ
  // تُفعّله سوبر سيل في الساس فيصل تفعيلٌ بـsasId مختلف ⇒ صفٌّ ثانٍ بـ١٠ أيّام.
  // 🔑 والمطابقةُ باليوزر: **«اليوزرُ هو الفيصلُ الأكبرُ الذي لا يُخطئ»** — فإن وُجد
  //    صفُّه استُعمل هو ولم يُنشأ ثانٍ، فيُسجَّل التفعيلُ على صاحبه الصحيح.
  const subByUserPhase1 = new Map<string, { id: number; sasId: number | null; name: string | null; netUser: string | null; dateTo: Date | null }>();
  for (const s of await prisma.subscriber.findMany({
    where: { towerId: officeId, isDeleted: false, netUser: { not: null } },
    select: { id: true, sasId: true, name: true, netUser: true, dateTo: true },
  })) {
    const u = (s.netUser ?? "").trim().toLowerCase();
    if (u && !subByUserPhase1.has(u)) subByUserPhase1.set(u, s);
  }
  const subById = new Map(officeSubs.map((s) => [s.id, s]));
  // ═════ 💰 «مقبوضٌ عندي» تُقاس على **اليوزر** لا على صفّ المشترك (العلّةُ الأمّ 2026-08-21) ═════
  // حالةُ bg-13-6-3@mu بنصّها: صفّان لليوزر نفسِه — أحدُهما تنصيبُ محمد بوصلِه (٣٥ ألفاً)،
  // والآخرُ أنشأته المزامنةُ القديمة حين أعادت الشركةُ إنشاءَ حساب الساس برقمٍ جديد.
  // وكلُّ فحوص الوصل كانت تسأل عن `subscriberId` **الصفِّ المرصود** — وهو الفارغُ — فتعمى
  // عن مالٍ مقبوضٍ فعلاً وتُظهره «خارجيّاً». واليوزرُ هو الفيصلُ الذي لا يُخطئ، فتُجمَع
  // وصولاتُ **كلّ** صفوفه. (٣٣ يوزراً مكرَّراً في مكاتب محمد يوم القياس.)
  const idsByUser = new Map<string, number[]>();
  for (const s of await prisma.subscriber.findMany({
    where: { towerId: officeId, isDeleted: false, netUser: { not: null } },
    select: { id: true, netUser: true },
  })) {
    const u = (s.netUser ?? "").trim().toLowerCase();
    if (!u) continue;
    const l = idsByUser.get(u) ?? []; l.push(s.id); idsByUser.set(u, l);
  }
  // 🪟 **أُلغيت «النافذةُ الزمنيّة»** (قياسُ 2026-08-21): تقريرُ التفعيلات مُجمَّعٌ بالمنجر
  // لا مرتَّبٌ بالتاريخ (٥٠٠ صفٍّ في الصفحة الأولى كلُّها منجرٌ واحدٌ من ٢٠٢٥-٠١ إلى
  // ٢٠٢٥-٠٥)، فأيُّ مسحٍ زمنيٍّ يقع في كتلةِ منجرٍ ويظنّ أنّه أتمّ — فيغيب عنه منجرُ
  // الكابينات كلُّه. والبديلُ المُثبَت: **سؤالٌ موجَّهٌ بالبحث** (يوزراً أو سيريالاً).
  const receiptCache = new Map<string, { at: number[]; to: number[]; entries: { at: number; money: number }[] }>();
  const receiptsOfUser = async (userKey: string, fallbackSubId?: number) => {
    const k = userKey || `#${fallbackSubId ?? 0}`;
    const cached = receiptCache.get(k);
    if (cached) return cached;
    const ids = idsByUser.get(userKey) ?? (fallbackSubId != null ? [fallbackSubId] : []);
    let out = { at: [] as number[], to: [] as number[], entries: [] as { at: number; money: number }[] };
    if (ids.length) {
      const rows = await prisma.subscriptionEntry.findMany({
        where: { subscriberId: { in: ids }, isDeleted: false },
        // 💵 `money` = **قيمةُ الاشتراك** لا الواصل: مشتركٌ فعّلتَه وبقي عليه دَينٌ وصلُه
        //    موجودٌ ولا يصحّ اتّهامُه (إعلانُ محمد على قاعدة ٩ · 2026-08-22).
        select: { date: true, dateTo: true, money: true },
        orderBy: { id: "desc" }, take: 60,
      });
      out = {
        at: rows.map((r) => r.date?.getTime() ?? 0).filter(Boolean),
        to: rows.map((r) => r.dateTo?.getTime() ?? 0).filter(Boolean),
        entries: rows
          .filter((r) => r.date)
          .map((r) => ({ at: r.date!.getTime(), money: Math.round(r.money ?? 0) })),
      };
    }
    receiptCache.set(k, out);
    return out;
  };
  /** وصلٌ قريبٌ من لحظة التفعيل، **أو** وصلٌ ينتهي بانتهاء الساس نفسِه (طلب محمد:
   *  «قارِنْ تاريخَ التفعيل بتاريخ الوصل») — أيُّهما تحقّق فالمالُ مقبوضٌ عندنا. */
  const collectedByUs = async (
    userKey: string, subId: number, actAt: Date | null, newExp: Date | null,
  ): Promise<boolean> => {
    const r = await receiptsOfUser(userKey, subId);
    if (actAt && r.at.some((t) => Math.abs(t - actAt.getTime()) <= RECEIPT_NEAR_MS)) return true;
    if (newExp && r.to.some((t) => Math.abs(t - newExp.getTime()) <= RECEIPT_NEAR_MS)) return true;
    return false;
  };

  // ═════ 🎴 قاعدةُ الوصل للكروت — إملاءُ محمد 2026-08-22 ═════
  //   ٥· «الكارتُ يُعلَّم مستخدماً إذا فُعِّل في الساس **ووُجد أنّ المشترك نفسَه لديه تفعيلٌ
  //       ووصلٌ في ±٣ أيّام»**.
  //   ٦· «وإذا لم يكن لليوزر وصلٌ في البرنامج فهذا الكارتُ **مسروقٌ من المخزن**» — ويشمل
  //       اليوزرَ غيرَ الموجود عندنا أصلاً، **لأنّ الكارتَ يُعطي باقةً موجودةً دائماً
  //       والتنصيبُ باقتُه عرضٌ دائماً** (تعليلُ محمد) ⇒ فوجودُ كارتٍ ينفي أن يكون تنصيباً.
  //   ٩· والمكرَّرُ يُقاس **بالمال**: مجموعُ الوصولات ≥ مجموعُ مبالغ التفعيلات ⇒ طبيعيّ.
  const CARD_RECEIPT_MS = 3 * 86400_000;  // ±٣ أيّام بين وقتِ تفعيل الساس وتاريخِ وصلنا
  const STOLEN_GRACE_MS = 24 * 3600_000;  // مهلةُ الورق: لا يُتَّهم أحدٌ قبل مرور يومٍ كامل

  /** وصلٌ لصاحب اليوزر في ±٣ أيّامٍ من وقت التفعيل؟ (وجودُه يكفي — المبلغُ لا يُشترَط) */
  const receiptNearCard = async (userKey: string, subId: number | null, actAt: Date | null): Promise<boolean> => {
    if (!actAt || isNaN(actAt.getTime())) return true; // بلا وقتٍ لا يُحكَم — والسكوتُ أسلم
    const r = await receiptsOfUser(userKey, subId ?? undefined);
    return r.at.some((t) => Math.abs(t - actAt.getTime()) <= CARD_RECEIPT_MS);
  };

  /** مجموعُ **قيم** وصولاته في نافذة ±٣ أيّامٍ حول لحظةٍ (لقاعدة «المكرَّر بالمال») */
  const receiptsSumNear = async (userKey: string, subId: number | null, at: Date): Promise<number> => {
    const r = await receiptsOfUser(userKey, subId ?? undefined);
    return r.entries
      .filter((e) => Math.abs(e.at - at.getTime()) <= CARD_RECEIPT_MS)
      .reduce((x, e) => x + e.money, 0);
  };

  /**
   * 🕵️ هل استهلك الكارتَ **إنسانٌ في البرنامج**؟ (بيعٌ أو تفعيلٌ) — فلا يُتَّهم أحدٌ ظلماً.
   *  ⚠️ العلّةُ التي يمنعها: مسارُ «بيع كارت» (`recharge-cards/[id]/sell`) يُعلّم الكارتَ
   *     مستخدماً باسم البائع **بلا وصل اشتراكٍ ولا مشترك** — فكلُّ كارتٍ مبيعٍ يُفعّله
   *     مشتريه في الساس كان سيُرفَع «سرقةً» كلَّ ليلة. والفاصلُ: مَن استهلكه.
   */
  const consumedByHuman = (c: { useDate: Date | null; userName: string | null; subscriberId: number | null }): boolean =>
    !!c.useDate && !!(c.userName ?? "").trim() && (c.userName ?? "").trim().toLowerCase() !== "sync";

  /**
   * 🎴 كارتٌ **من مخزننا** ظهر مُفعَّلاً في الساس — الحكمُ في موضعٍ واحدٍ لا في فرعَين:
   *   ١· يُعلَّم مستخدماً بوقت التفعيل (حمايةٌ لا اتّهام: كي لا يُسحَب ويُباع مرّةً ثانية).
   *   ٢· ثمّ يُسأل: أله وصلٌ في ±٣ أيّام؟ نعم ⇒ انتهى الأمر · لا ⇒ **حالةُ سرقةٍ** في حارس المال.
   *   ٣· ومهلةُ الورق ٢٤ ساعة: لا تُرفَع الحالةُ قبلها (وصلُ الليلة يُسجَّل صباحاً).
   *   ٤· ولا يُتَّهم كارتٌ **استهلكه إنسانٌ في البرنامج** (بيعاً أو تفعيلاً) — ذاك ماله مقبوض.
   * ⚠️ ولا يتحرّك أيُّ مالٍ هنا إطلاقاً: لا وصلَ يُنشأ، ولا دينَ كارتٍ يُنقَص، ولا دينَ مشترك.
   */
  const handleStockCard = async (
    card: { id: number; serial: string | null; useDate: Date | null; subscriberId: number | null; userName: string | null; reservedBy: number | null },
    a: SasActivation,
    pin: string,
    sub: { id: number; name: string | null; netUser: string | null } | null,
    netUser: string | null,
    name: string | null,
  ): Promise<void> => {
    const raw = a.createdAt ? new Date(a.createdAt) : new Date();
    const when = isNaN(raw.getTime()) ? new Date() : raw;
    const wasHuman = consumedByHuman(card); // يُقرأ **قبل** أن نكتب عليه
    if (!card.useDate) {
      await prisma.rechargeCard.update({
        where: { id: card.id },
        data: {
          useDate: when, userName: "sync",
          ...(sub ? { subscriberId: sub.id } : {}),
          reservedBy: null, reservedAt: null,
        },
      });
      card.useDate = when; // تحديثٌ محلّيٌّ يمنع إعادة المعالجة في نفس الدورة
      markedUsed++;
      events.push({
        scenario: 3, subscriber: name ?? netUser, pin,
        detail: sub ? "تحديث حالة الكارت إلى مستخدم" : "كارتٌ استُهلك ليوزرٍ غير مستوردٍ بعد — عُلّم مستخدماً",
      });
    }
    if (wasHuman) return; // بِيع أو فُعِّل بيد إنسانٍ عندنا ⇒ ليس سرقةً
    const uKey = (netUser ?? "").trim().toLowerCase();
    if (await receiptNearCard(uKey, sub?.id ?? null, when)) return; // ✅ له وصلٌ ⇒ سليم
    if (Date.now() - when.getTime() < STOLEN_GRACE_MS) return;      // ⏳ مهلةُ الورق
    // 🕵️ مَن سحبه: الاسمُ المكتوبُ على الكارت، وإلّا صاحبُ الحجز (رقمُ مستخدمٍ ⇒ يُترجَم اسماً)
    let puller = (card.userName ?? "").trim();
    if (!puller || puller.toLowerCase() === "sync") {
      puller = card.reservedBy != null
        ? (await prisma.user.findUnique({ where: { id: card.reservedBy }, select: { fullName: true, username: true } })
            .then((x) => (x?.fullName ?? x?.username ?? "").trim()).catch(() => ""))
        : "";
    }
    await recordStolenCardCase({
      agentId: office.agentId ?? -1, towerId: officeId, sasId: a.sasUserId,
      subscriberId: sub?.id ?? null, netUser, name, activatedAt: when,
      pins: [pin], amount: Math.round(a.price || 0),
      detail: `🔴 كارتٌ **من مخزنك** (سيريال ${pin}) فُعِّل في الساس ليوزر ${netUser ?? "—"} بمبلغ ${Math.round(a.price || 0)}`
        + ` بمنجر ${(a.managerUsername ?? "—").trim()} بتاريخ ${when.toISOString().slice(0, 16).replace("T", " ")}`
        + ` — **ولا وصلَ له عندك في ±٣ أيّام**${puller ? ` · سحبه من المخزن: ${puller}` : ""}${sub ? "" : " · واليوزرُ غيرُ مستوردٍ في البرنامج"}.`,
    });
    stolenCards++;
  };


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

  // 🗂️ **فهرسُ تفعيلات النافذة باليوزر** (الطبقةُ الثانية 2026-08-22): الصفحةُ محمَّلةٌ
  //    أصلاً، فتصنيفُ «قفزة التاريخ» يُقرأ منها بصفر نداءات — وكان يكلّف سؤالاً موجَّهاً
  //    لكلّ مشترك بسقفٍ صامتٍ عند ١٢٠. الأحدثُ أوّلاً كما يعيده البحثُ تماماً.
  const actsByUserAll = new Map<string, SasActivation[]>();
  for (const a of actsWide) {
    const uk = (a.username ?? "").trim().toLowerCase();
    if (!uk) continue;
    const l = actsByUserAll.get(uk) ?? []; l.push(a); actsByUserAll.set(uk, l);
  }
  for (const l of actsByUserAll.values()) {
    l.sort((x, y) => new Date(y.createdAt ?? 0).getTime() - new Date(x.createdAt ?? 0).getTime());
  }

  // 🎴 كروتٌ خارجُ المخزن استُعملت في الساس — تُجمَع لكلّ مشترك ثمّ تُحلَّل مرّةً واحدة
  const extCards = new Map<string, { sub: { id: number; name: string | null; netUser: string | null }; sasId: number; pins: string[]; at: Date; price: number }>();
  for (const a of acts) {
    const pin = (a.pin ?? "").trim();
    const card = pin ? cardBySerial.get(pin) : undefined;
    const managerMatch = (a.managerUsername ?? "").trim().toLowerCase() === officeUser;

    // السيناريو 7: مشترك جديد في SAS غير موجود بالبرنامج → استيراد تلقائي + إبلاغ
    let sub = subBySasId.get(a.sasUserId);
    // 🔑 لا صفَّ ثانياً ليوزرٍ موجود: يُستعمل صفُّه القائم (وسجّلْ أنّ sasId تغيّر)
    if (!sub) {
      const uKey = (a.username ?? "").trim().toLowerCase();
      const byUser = uKey ? subByUserPhase1.get(uKey) : undefined;
      if (byUser) {
        sub = byUser;
        subBySasId.set(a.sasUserId, byUser);
        dupUserPhase1++;
      }
    }
    if (!sub) {
      // ═════ 📋 لا استيرادَ تلقائيّاً (قرار محمد 2026-08-20): يُرصَد في تبويب «تنصيب
      // خارجي» بسجلّ المزامنة، والحفظُ بيد صاحب الصلاحيّة. (السيناريو 7 القديم أُلغي.)
      const newDate = a.newExpiration ? new Date(a.newExpiration) : null;
      await recordInstall({
        agentId: office.agentId ?? -1, towerId: officeId, sasId: a.sasUserId, subscriberId: null,
        netUser: a.username, name: a.name, phone: null, address: null,
        packageName: null, sasDateTo: newDate && !isNaN(newDate.getTime()) ? newDate : null,
      });
      // 🎴 **والكارتُ يُعلَّم مستخدماً حتى بلا صاحبٍ معروف** (بلاغ محمد 2026-08-21):
      // كارتٌ استُهلك في الساس ليوزرٍ ليس عندنا يبقى «متاحاً» في المخزن فيُسحب مرّةً ثانية.
      // 🔴 **وبقاعدة محمد 2026-08-22 هو سرقةٌ أيضاً**: الكارتُ يُعطي باقةً موجودةً دائماً
      //    والتنصيبُ باقتُه عرضٌ دائماً ⇒ فكارتٌ من مخزننا ليوزرٍ لا وصلَ له عندنا = مالٌ خرج.
      if (card) await handleStockCard(card, a, pin, null, a.username ?? null, a.name ?? null);
      continue;
    }

    if (card) {
      internal++;
      // السيناريو 3 + قاعدتا محمد ٥ و٦ (2026-08-22) — كلُّهما في `handleStockCard`
      await handleStockCard(card, a, pin, sub, a.username ?? sub.netUser, sub.name ?? null);
    } else if (isCardActivation(a) && managerMatch) {
      // السيناريو 6: Manager يطابق يوزر المكتب لكن الكارت غير موجود بمخزن البرنامج → كارت خارجي
      external++;
      events.push({ scenario: 6, subscriber: sub.name ?? sub.netUser, pin, detail: "تفعيل بكارت خارجي غير موجود بالمخزن" });
      // 💰 ويُجمَع ليُحلَّل ويُخزَّن في حارس المال بعد الحلقة (إملاءُ محمد: لا حالةَ بلا بيت)
      const key = `${sub.id}|${a.sasUserId}`;
      const g = extCards.get(key) ?? { sub, sasId: a.sasUserId, pins: [] as string[], at: a.createdAt ? new Date(a.createdAt) : new Date(), price: 0 };
      g.pins.push(pin);
      g.price += Math.round(a.price || 0);
      const t = a.createdAt ? new Date(a.createdAt) : null;
      if (t && !isNaN(t.getTime()) && t > g.at) g.at = t;
      extCards.set(key, g);
    } else if (isCardActivation(a)) {
      // كارت غير معروف من Manager آخر — لا يُبلَّغ عنه هنا (تصحيح التاريخ يتم بالمرحلة 2 بصمت — السيناريو 5)
      external++;
    }

    // ═══ البند ٤-ب · «فعّل بنفسه» ⇒ رسالةٌ له (طلبُ محمد 2026-08-13) ═══
    // القاعدةُ بنصّه: «إن كان manager في الساس **نفسَ اسم حساب المكتب** ⇒ الوكيلُ فعّله،
    // وإن كان **غيرَه** ⇒ فعّل بنفسه». وقِيس حيّاً: تفعيلاتُ المواصلات كلُّها باسم
    // `FDT13-MU` (موقعُ المشترك حين يُفعّل من تطبيق سوبر سيل)، وتفعيلاتُ الشدن كلُّها
    // باسم حساب المكتب — فالقاعدةُ صحيحةٌ على بياناتٍ حقيقيّة لا افتراضاً.
    // 🔑 والختمُ بتاريخ الانتهاء الناتج لا بلحظة الإرسال: المزامنةُ تُعيد قراءةَ تفعيلاتِ
    //    الأمس في **كلّ دورة**، فبلا ذلك تُرسَل الرسالةُ كلَّ دورةٍ إلى الأبد.
    // 📋 وصارت مشروطةً بجيك بوكس «إرسال رسائل تلقائي» في تبويب «تفعيل خارجي» (طلب محمد
    // 2026-08-20، والافتراضيُّ إيقاف) — وبلا صحٍّ يُرسَل يدويّاً من النافذة بنفس القالب.
    // 📨 وعبر طابور سجلّ المزامنة الدائم (2026-08-21): لا يُمسَح، وحارسُ dedupKey الفيزيائيُّ
    // يجعل إعادةَ قراءةِ تفعيلات الأمس كلَّ دورةٍ بلا أثرٍ — الرسالةُ واحدةٌ للحدث مهما تكرّر.
    if (autoMsg.self && !managerMatch && a.newExpiration) {
      const selfActDate = new Date(a.newExpiration);
      if (!isNaN(selfActDate.getTime())) {
        await sendSyncLogMessage("self", {
          towerId: officeId, sasId: a.sasUserId,
          activatedAt: a.createdAt ? new Date(a.createdAt) : null,
          subscriberId: sub.id, netUser: a.username ?? sub.netUser, name: a.name ?? sub.name,
          sasDateTo: selfActDate,
        });
      }
    }

  }

  // ═════ 📋 أحداث سجلّ المزامنة — تبويبات ٢ و٣ و٤ (مُراجَعةٌ عميقةٌ 2026-08-21) ═════
  // 🔴 **النافذةُ صارت (الأمس + اليوم)**: كانت الأحداثُ تُقرأ من تفعيلات الأمس وحدَها،
  //   فتفعيلةُ اليوم لا تصير حدثاً أبداً — وتظهر بدلاً منها «فرقَ أيّام» في تبويب
  //   المعلومات (حالة bg-63-8-1@res: منجرُها FDT63-RES وظهرت «تحديثَ معلومات»).
  //   وتقاريرُ السيناريوهات تبقى على الأمس كما كانت (لا تتكرّر).
  // 🏷️ والتصنيفُ بالمنجر صار ثلاثيّاً مطابقاً لتصنيف محمد:
  //   · منجر = اسمُ صفحة الساس ⇒ «تفعيلات ساس» (تبويب ٤)
  //   · منجر = **كابينةُ صاحب اليوزر نفسِه** (FDT+المقطع الأوّل+لاحقة @) ⇒ «تفعيل خارجي» (٣)
  //   · أيُّ منجرٍ آخرَ (ديلر/شركة) ⇒ «تنصيب خارجي» (٢) بوصفه إعادةَ خدمةٍ من الشركة —
  //     وكان يسقط في الفراغ فلا يظهر في أيّ تبويب.
  // 💰 وفي الأنواع الثلاثة: «مقبوضٌ عندي ⇒ ليس خارجيّاً» (وصلٌ ±١٢ ساعة **أو** تاريخُنا
  //   يغطّي انتهاءَ الساس)، وصاحبُ القرض مستثنًى من الغطاء.
  for (const a of actsWide) {
    const actAt = a.createdAt ? new Date(a.createdAt) : null;
    if (!actAt || isNaN(actAt.getTime())) continue;
    let sub = subBySasId.get(a.sasUserId);
    if (!sub) {
      const uk = (a.username ?? "").trim().toLowerCase();
      const byUser = uk ? subByUserPhase1.get(uk) : undefined;
      if (byUser) sub = byUser;
    }
    // 🔑 **الإسكاتُ مشروطٌ بوجود بيتٍ للواقعة** (قرارُ محمد 2026-08-22): «له تفعيلةٌ في
    //    النافذة ⇒ بيتُها تبويبُ التفعيل» صحيحةٌ **ما دام الصفُّ معلَّقاً**. أمّا صفٌّ
    //    أُغلق بـ«اعتُبر معالَجاً» فلا بيتَ فيه — وإسكاتُ فرق الأيّام حينها يُضيّعه للأبد.
    //    فالإضافةُ صارت في كلّ فرعٍ بحسبه، لا واحدةً عمياءَ في رأس الحلقة.
    if (!sub) { actedSasIds.add(a.sasUserId); continue; } // غيرُ مستوردٍ ⇒ ترصده المرحلةُ الثانية
    const mgr = (a.managerUsername ?? "").trim();
    const managerIsPage = mgr.toLowerCase() === officeUser;
    const ownCabinet = isOwnCabinet(a.username ?? sub.netUser, mgr);
    const newExp = a.newExpiration ? new Date(a.newExpiration) : null;
    const validNewExp = newExp && !isNaN(newExp.getTime()) ? newExp : null;
    const evBase = {
      agentId: office.agentId ?? -1, towerId: officeId, sasId: a.sasUserId, subscriberId: sub.id,
      netUser: a.username ?? sub.netUser, name: a.name ?? sub.name,
      amount: Math.round(a.price || 0), activatedAt: actAt,
      sasDateTo: validNewExp,
    };
    // «مقبوضٌ عندي» — الغطاءُ بالتاريخ ثمّ الوصلُ بنافذة ±١٢ ساعة
    const COVER_TOL_MS = 24 * 3600_000;
    const covered = !!(validNewExp && sub.dateTo && sub.dateTo.getTime() >= validNewExp.getTime() - COVER_TOL_MS && !loanSubIdsP1.has(sub.id));
    if (covered) { actedSasIds.add(a.sasUserId); await resolveEventIfReceipted(officeId, a.sasUserId, actAt); continue; }
    // 💰 قاعدةُ محمد بحرفها: «إن كان لديه وصلُ تفعيلٍ عندي فليس خارجيّاً أبداً» —
    // وتُقاس على **اليوزر** (كلّ صفوفه) وبتاريخَين: قربُ الوصل من التفعيل، أو انتهاءُ
    // الوصل بانتهاء الساس نفسِه. (كانت على صفٍّ واحدٍ وبنافذة ±١٢ ساعةً وحدَها.)
    const subUserKey = (a.username ?? sub.netUser ?? "").trim().toLowerCase();
    if (await collectedByUs(subUserKey, sub.id, actAt, validNewExp)) {
      actedSasIds.add(a.sasUserId);
      await resolveEventIfReceipted(officeId, a.sasUserId, actAt); continue;
    }
    // 💸 القرض (تصحيحُ محمد 2026-08-21): **سعرُ صفرٍ يدلّ دائماً على قرض** — وأُسقط شرطُ
    //    «بلا كارت»، فحالةُ bg-1-14-2@mu كانت صفراً **بكارت** فمرّت تفعيلاً خارجيّاً.
    const isLoanAct = Math.round(a.price || 0) <= 0;
    let outcome: EventOutcome;
    if (managerIsPage || ownCabinet) {
      outcome = await recordActivationEvent(managerIsPage ? "sas" : "self", { ...evBase, loan: isLoanAct });
    } else {
      // ديلر/شركة ⇒ تبويب «تنصيب خارجي» حدثاً مؤرَّخاً (إعادةُ خدمةٍ من الشركة)
      stillInstalls.add(a.sasUserId);
      outcome = await recordCompanyActivation({ ...evBase, loan: isLoanAct, managerName: mgr || null });
    }
    // 🔓 صفٌّ مُغلَقٌ سلفاً (وليس قرضاً) ⇒ **لا يُسكِت**: يُترَك فرقُ الأيّام يظهر في «تحديث معلومات»
    if (outcome !== "closed" || isLoanAct) actedSasIds.add(a.sasUserId);
  }

  // ═════ 🎴💰 تحليلُ الكروت الخارجيّة وتخزينُها في حارس المال (إملاءُ محمد 2026-08-21) ═════
  // «لو فُحص سجلُّ وصولات المشترك نفسِه لَوُجد أنّ لديه وصلَ تفعيلِ ٣ أشهر… ولو دُقّق
  //  المبلغُ لَوُجد أنّه مبلغُ ٣ أشهرٍ ناقص ٥ آلاف، وهي حالةُ تفعيل ديلرٍ ٣ أشهر —
  //  والديلرُ يُفعَّل بكروتٍ خارجيّةٍ **دائماً**». فالتقييمُ يُبنى على الوصل لا على الظنّ.
  for (const [, g] of extCards) {
    try {
      const uk = (g.sub.netUser ?? "").trim().toLowerCase();
      const r = await receiptsOfUser(uk, g.sub.id);
      const near = r.at.filter((t) => Math.abs(t - g.at.getTime()) <= RECEIPT_NEAR_MS);
      const rows = near.length
        ? await prisma.subscriptionEntry.findMany({
            where: {
              subscriberId: { in: idsByUser.get(uk) ?? [g.sub.id] }, isDeleted: false,
              date: { gte: new Date(g.at.getTime() - RECEIPT_NEAR_MS), lte: new Date(g.at.getTime() + RECEIPT_NEAR_MS) },
            },
            select: { id: true, money: true, moneyIn: true, month: true, cardType: true },
          })
        : [];
      const paid = rows.reduce((x, e) => x + Math.round(e.moneyIn ?? 0), 0);
      const billed = rows.reduce((x, e) => x + Math.round(e.money ?? 0), 0);
      const months = rows.map((e) => Number(e.month) || 1).reduce((x, m) => x + m, 0);
      const dealer = g.pins.length >= 2 && rows.length > 0;
      const verdict = rows.length === 0 ? "no-receipt" : dealer ? "dealer" : "receipted";
      const money = `وصلٌ ${rows.length ? `#${rows.map((e) => e.id).join("،")} بمبلغ ${billed} (مقبوضٌ ${paid})${months ? ` لـ${months} شهر` : ""}` : "غيرُ موجود"}`;
      const detail = verdict === "dealer"
        ? `🤝 تفعيلُ ديلر: ${g.pins.length} كروتٍ من خارج المخزن ليوزر ${g.sub.netUser ?? "—"} — ${money}. والديلرُ يُفعَّل بكروتٍ خارجيّةٍ دائماً، والمالُ مقبوضٌ عندك ⇒ **حالةٌ بسيطةٌ غيرُ ضارّة**.`
        : verdict === "receipted"
          ? `🎴 كارتٌ من خارج المخزن (${g.pins.length}) ليوزر ${g.sub.netUser ?? "—"} — ${money}. المالُ مقبوضٌ عندك ⇒ لا ضرر، والسببُ غالباً كارتٌ لم يُسجَّل في المخزن.`
          : `🔴 ${g.pins.length} كارتٍ من خارج المخزن ليوزر ${g.sub.netUser ?? "—"} **بلا أيّ وصلٍ في نافذة ٣٦ ساعة** — يحتاج تدقيقاً: مَن قبض ثمنَه؟`;
      await recordExternalCardCase({
        agentId: office.agentId ?? -1, towerId: officeId, sasId: g.sasId, subscriberId: g.sub.id,
        netUser: g.sub.netUser, name: g.sub.name, activatedAt: g.at,
        pins: g.pins, amount: g.price, verdict, detail,
      });
    } catch { /* أفضلُ جهدٍ — لا تُفشل المزامنة */ }
  }

  // السيناريو 2: تفعيل متكرر في SAS لنفس المشترك بنفس اليوم بينما البرنامج يعرف كارتاً واحداً
  // 💵 **المكرَّرُ يُقاس بالمال لا بعدد الكروت** (إملاءُ محمد 2026-08-22): «إذا المشتركُ
  //    مفعَّلٌ بوصلَين، أو وصلٍ واحدٍ مجموعُه هو مبلغُ الوصلَين، فلا يُعلَّم — فهي حالةٌ
  //    طبيعيّة». وكان العدُّ بعدد الكروت وحدَه يُنتج إنذاراً كاذباً لكلّ من فعّل شهرَين
  //    بكارتَين ووصلٍ واحد. والحكمُ على **المجموع** لا على سيريالٍ بعينه — فلا يُتَّهم كارتٌ
  //    ظلماً حين لا يُعرَف أيُّهما لم يُدفَع ثمنُه.
  for (const [sasUserId, list] of actsByUser) {
    const cardActs = list.filter(isCardActivation);
    if (cardActs.length <= 1) continue;
    const sub = subBySasId.get(sasUserId);
    const totalActs = cardActs.reduce((x, a) => x + Math.round(a.price || 0), 0);
    if (totalActs <= 0) continue; // بلا مالٍ في الميزان لا إنذار (قروضُ الصفر)
    const times = cardActs.map((a) => (a.createdAt ? new Date(a.createdAt).getTime() : 0)).filter(Boolean);
    const at = new Date(times.length ? Math.max(...times) : Date.now());
    const uKey = (list[0]?.username ?? sub?.netUser ?? "").trim().toLowerCase();
    const paid = await receiptsSumNear(uKey, sub?.id ?? null, at);
    if (paid >= totalActs) continue; // ✅ وصولاتُه تغطّي تفعيلاتِه ⇒ طبيعيّ
    // 🤝 **خصمُ الديلر يُسكَت** (قرارُ محمد 2026-08-22 على حالةٍ حيّة): «ديلرُ الثلاثة
    //    أشهرٍ يُفعَّل بكروتٍ خارجيّةٍ دائماً، ووصلُه مبلغُ ثلاثة أشهرٍ **ناقص خمسة آلاف**».
    //    وقِيست الحالةُ ليلتَها: حوراء الخفاجي — ٣ كروتٍ بمجموع ١٣٥٬٠٠٠ ووصولاتٌ ١٣٠٬٠٠٠
    //    ⇒ فارقٌ ٥٬٠٠٠ **بالضبط** = خصمُ الديلر لا مالٌ ناقص. فيُسكَت عنه بشرطَيه:
    //    كارتان فأكثر (نمطُ الديلر) ووصلٌ موجودٌ فعلاً — وأيُّ فارقٍ آخرَ يبقى إنذاراً.
    const DEALER_DISCOUNT = 5000;
    if (paid > 0 && cardActs.length >= 2 && totalActs - paid === DEALER_DISCOUNT) continue;
    duplicates++;
    events.push({
      scenario: 2, subscriber: sub?.name ?? list[0]?.username ?? null,
      detail: `الساس: ${cardActs.length} تفعيلاتِ كارتٍ بمجموع ${totalActs} · وصولاتُك في ±٣ أيّام: ${paid} ⇒ **الفارق ${totalActs - paid}** (السيريالات: ${cardActs.map((a) => (a.pin ?? "—").trim()).join("، ")})`,
    });
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
      // 🎴 بحثٌ مباشرٌ بسيريال الكارت (يعمل — والمسحُ الزمنيُّ هو الذي كان يكذب):
      //    وُجد ⇒ ليس وهميّاً · تعذّر الفحصُ ⇒ **لا حكمَ** فيُعدّ حقيقيّاً احتياطاً.
      const pr = await sasProbeSerial(base, token, (toVerify[i].serial ?? "").trim());
      if (pr.hit || !pr.ok) realFlags[i] = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, toVerify.length) }, worker));
  let verifiedReal = 0;
  const suspects: typeof preSuspects = [...overflow];
  for (let i = 0; i < toVerify.length; i++) {
    if (realFlags[i]) verifiedReal++;      // تفعيل حقيقي (بتاريخ/حساب فرعي مختلف) — ليس وهمياً
    else suspects.push(toVerify[i]);
  }
  // ═════ 🎴 تبرئةُ الكروت التي وُسمت «وهميّةً» ظلماً (بلاغُ محمد 2026-08-21) ═════
  // وسمُ الوهميّة كان يُكتَب اعتماداً على بحثٍ بالسيريال؛ ومتى أثبتت النافذةُ المفهرَسةُ
  // أنّ الكارت **مُفعَّلٌ فعلاً** سقط الوسمُ من نفسه — فيُكتَب أثرُ «ربط» يُسقطه من لوحة
  // «الكروت الوهمية» بلا أيّ ضغطةٍ من المدير (اللوحةُ تُسقط ما رُبط بعد اكتشافه).
  for (let i = 0; i < toVerify.length; i++) {
    if (!realFlags[i]) continue;
    const cid = toVerify[i].id;
    try {
      const flagged = await prisma.auditLog.findFirst({
        where: { action: "SYNC_PHANTOM_VERIFIED", entityId: String(cid), createdAt: { gte: new Date(Date.now() - 120 * 86400_000) } },
        orderBy: { id: "desc" }, select: { id: true, createdAt: true },
      });
      if (!flagged) continue;
      const cleared = await prisma.auditLog.findFirst({
        where: { action: "PHANTOM_CARD_LINK", entityId: String(cid), createdAt: { gte: flagged.createdAt } },
        select: { id: true },
      });
      if (cleared) continue;
      await prisma.auditLog.create({
        data: {
          action: "PHANTOM_CARD_LINK", entity: "rechargeCard", entityId: String(cid),
          details: `المزامنة: أثبتت نافذةُ تفعيلات الساس أنّ السيريال ${(toVerify[i].serial ?? "").trim()} مُستعمَلٌ فعلاً — وسمُ «وهميّ» ساقط`,
        },
      });
    } catch { /* التبرئةُ أفضلُ جهدٍ ولا تُفشل المزامنة */ }
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
  let checked = 0, dateFixed = 0, phase2Failed = false, skippedPkg = 0;
  const phase2Imported = 0, pkgFixed = 0; // 📋 صفران منذ سجلّ المزامنة (الاستيراد/الربط يدويّان)
  // البند ٥ · مشتركٌ في الساس يوزرُه موجودٌ عندنا بصفٍّ آخر ⇒ لم يُستورَد (منعُ التكرار)
  let dupUserSkipped = 0;
  let phase2Error = "";
  try {
    const allUsers = await sasFetchAllUsers(base, token);
    const progSubs = await prisma.subscriber.findMany({
      where: { towerId: officeId, ...panelWhere, isDeleted: false, sasId: { not: null } },
      select: { id: true, sasId: true, dateTo: true, packageId: true, address: true, phone: true, name: true, netUser: true },
    });
    const progBySasId = new Map(progSubs.map((s) => [s.sasId as number, s]));

    // ═════ 🔴 البند ٥ · حرسُ تكرار اليوزر (طلبُ محمد 2026-08-13/14) ═════
    // نصُّه: **«اليوزرُ هو الفيصلُ الأكبرُ الذي لا يُخطئ»** — لا الاسمُ ولا الهاتف.
    // والاستيرادُ أدناه يُطابق بـ`sasId` وحدَه؛ فمشتركٌ أعادت الشركةُ تنصيبَه فتغيّر
    // `sasId` **ويوزرُه هو نفسُه** يُستورَد **صفّاً ثانياً** ⇒ يوزرٌ واحدٌ بصفَّين.
    // 🎯 وقِيس على الإنتاج (2026-08-14): **٥٢ يوزراً مكرَّراً** في مكاتبَ لخمسة وكلاء،
    //    والفهرسُ `subscribers_towerId_netUser_idx` **غيرُ فريدٍ** فلا شيءَ يمنع المزيد.
    // ⇒ فلا يُنشأ صفٌّ ليوزرٍ موجودٍ أبداً. والقرارُ في حالته (استبدالٌ كامل؟ دمج؟) بيد
    //   محمد لا بيد المزامنة — فالمزامنةُ **تتوقّف عن الإفساد** ولا تخترع حكماً.
    // 🔑 بكامل حقوله: صفُّ اليوزر القائم يصير **هو** المرجعَ في المقارنة حين يتغيّر رقمُ ساسه
    const progByUser = new Map<string, (typeof progSubs)[number]>();
    for (const s of await prisma.subscriber.findMany({
      where: { towerId: officeId, isDeleted: false, netUser: { not: null } },
      select: { id: true, sasId: true, dateTo: true, packageId: true, address: true, phone: true, name: true, netUser: true },
    })) {
      const u = (s.netUser ?? "").trim().toLowerCase();
      if (u && !progByUser.has(u)) progByUser.set(u, s);
    }


    // أصحاب القروض القائمة في هذا المكتب — المزامنة تتجاهلهم تماماً: لهم 7 أيام حقيقيّة في
    // الساس و30 يوماً وهميّة عندنا؛ ولو زامنّاهم لأفسدنا الأيام الوهميّة (طلب محمد 2026-08-06).
    // عزل صارم: مقيَّد بـ towerId = officeId (مكتب المزامنة وحده)، لا عموميّة.
    // 🔴 **ولا `panelWhere` هنا** (بلاغُ صميم 2026-08-13): `LoanDebt` **ليس فيه `sasPanelId`**
    //   — القرضُ يتبع المشترك، والمشتركُ وحدَه يتبع لوحة. فنشرُ نطاقِ اللوحة على هذا
    //   الاستعلام رمى `Unknown argument sasPanelId` **فأسقط المرحلةَ الثانيةَ كلَّها**
    //   (تصحيحُ التواريخ والاستيراد) على مكتبٍ بلوحتَين.
    // ✅ والترشيحُ بـ`towerId` وحدَه **صحيحٌ لا تنازل**: هذه المجموعةُ تُستعمل في موضعٍ
    //   واحدٍ فقط (`if (loanSubIds.has(p.id)) continue`) وحلقتُه تمرّ على `progSubs`
    //   **المقصورةِ على اللوحة سلفاً** ⇒ معرّفاتُ لوحةٍ أخرى في المجموعة لا تُصادَف
    //   أبداً. فالمجموعةُ الأوسعُ زيادةٌ لا تُقرأ، لا تسريبٌ ولا خلطٌ بين اللوحتَين.
    //   (والبديلُ — عمودُ لوحةٍ على القرض — تكرارٌ لمعلومةٍ يملكها المشترك، ويحتاج
    //    هجرةً وردماً رجعيّاً بلا فائدةٍ واحدة.)
    const loanRows = await prisma.loanDebt.findMany({
      where: { towerId: officeId, isDeleted: false },
      select: { subscriberId: true },
    });
    const loanSubIds = new Set(loanRows.map((r) => r.subscriberId));

    // فئات الاشتراك التي أضافها المدير — مطابقة متسامحة (فراغات/حالة/ترتيب كلمات/صيغ
    // عربية) عبر PackageMatcher، **وبعزل الوكيل** (كانت تقارن بباقات كل الوكلاء — خلل عزل).
    // مشتركٌ فئته في الساس غير معروفة ⇒ لا يُمَسّ إطلاقاً (بطلب صريح: فئة مجهولة = اتركه كما هو)
    const matcher = await matcherForOffice(officeId);
    // 📋 أسماءُ باقات البرنامج (لعرض «القديم» في تغييرات الباقة داخل سجلّ المزامنة)
    const pkgRows = await prisma.package.findMany({
      where: { agentId: office.agentId ?? -1, isDeleted: false }, select: { id: true, name: true },
    });
    const pkgNameById = new Map(pkgRows.map((x) => [x.id, x.name ?? `#${x.id}`]));

    // ═════ 🎯 (د) قفزةُ تاريخٍ بلا تفعيلةٍ في النافذة ⇒ سؤالٌ موجَّهٌ للساس ═════
    // بلاغُ محمد 2026-08-21 (bg-53-10-3@shu «فعّل لنفسه فلماذا يظهر تمديدَ أيّام؟»):
    // المزامنةُ تجلب تفعيلاتِ يومَين (الأمس واليوم) — فمن فُعِّل قبلَهما لا حدثَ له،
    // ويظهر **فرقَ تاريخٍ مجرّداً** في «تحديث معلومات»: بلا منجرٍ ولا مبلغٍ ولا تصنيف.
    // فبدل الظنّ نسأل الساسَ عن هذا اليوزر وحدَه، ونُصنّف بالمنجر كما يُصنَّف أيُّ حدث:
    //   صفحةُ المكتب ⇒ ساس · كابينةُ صاحبِه ⇒ ذاتيّ · غيرُهما ⇒ تنصيبُ شركة/ديلر.
    // 💰 وقاعدةُ محمد فوق ذلك كلِّه: **وصلٌ عندي ⇒ ليس خارجيّاً** — فيبقى فرقَ تاريخٍ
    //    يُطبَّق يدويّاً (المالُ مقبوضٌ، والناقصُ تاريخُنا وحدَه).
    // ونعودُ false عند أيّ شكّ (تعذّرُ الفحص · لا تفعيلةَ مطابقة) فيبقى الصفُّ كما كان.
    const classifyDateJump = async (
      sub: { id: number; netUser: string | null; name: string | null; dateTo: Date | null },
      sasId: number, username: string | null, newSasExp: Date | null,
    ): Promise<boolean> => {
      const uKey = (username ?? sub.netUser ?? "").trim().toLowerCase();
      if (!uKey) return false;
      // 🗂️ **من الصفحة المحمَّلة أوّلاً** (الطبقةُ الثانية): تفعيلاتُ النافذة كلُّها في
      //    الذاكرة، فلا نداءَ ولا سقف. والسؤالُ المباشرُ يبقى **للنادر** وحدَه: مَن وقع
      //    تفعيلُه قبل النافذة (شهرٌ مضى مثلاً) فلا سطرَ له في الصفحة.
      let rows = actsByUserAll.get(uKey) ?? [];
      if (!rows.length) {
        if (dateProbes >= MAX_DATE_PROBES) { probesCapped++; return false; }
        dateProbes++;
        const probe = await sasUserActivations(base, token, username ?? sub.netUser ?? "");
        if (!probe.ok || !probe.rows.length) return false; // تعذّرٌ أو لا تاريخَ ⇒ لا حكم
        rows = probe.rows;
      }
      // 💸 **شرطُ القرض الوحيد** (نصُّ محمد): آخرُ تفعيلٍ بمبلغ صفرٍ ⇒ قرضٌ ⇒ يُسكَت عنه
      const last = rows[0];
      if (last && Math.round(last.price || 0) <= 0) { actedSasIds.add(sasId); return true; }
      // التفعيلةُ التي أنتجت تاريخَ الساس الحاليّ (±١٢ ساعة)، وإلّا فآخرُ تفعيلاته
      const hit = (newSasExp && rows.find((r) => sameExpiry(r.newExpiration ? new Date(r.newExpiration) : null, newSasExp))) || last;
      const actAt = hit.createdAt ? new Date(hit.createdAt) : null;
      if (!actAt || isNaN(actAt.getTime())) return false;
      const newExp = hit.newExpiration ? new Date(hit.newExpiration) : null;
      // 💰 مقبوضٌ عندي (وصلٌ قريبٌ أو وصلٌ ينتهي بانتهائه) ⇒ ليس خارجيّاً — يبقى فرقَ تاريخٍ يدويّاً
      if (await collectedByUs(uKey, sub.id, actAt, newExp ?? newSasExp)) return false;
      const mgr = (hit.managerUsername ?? "").trim();
      // 🏷️ منجرُ صفحةِ المكتب ⇒ «تفعيلاتُ ساس» · منجرُ كابينةِ صاحبه ⇒ «تفعيلٌ خارجيّ» · غيرُهما ⇒ شركة
      const managerIsPage = mgr.toLowerCase() === officeUser;
      const ownCabinet = isOwnCabinet(hit.username ?? sub.netUser, mgr);
      const evBase = {
        agentId: office.agentId ?? -1, towerId: officeId, sasId, subscriberId: sub.id,
        netUser: hit.username ?? sub.netUser, name: hit.name ?? sub.name,
        amount: Math.round(hit.price || 0), activatedAt: actAt,
        sasDateTo: newExp && !isNaN(newExp.getTime()) ? newExp : null,
      };
      const isLoanAct = Math.round(hit.price || 0) <= 0;
      let outcome: EventOutcome;
      if (managerIsPage || ownCabinet) {
        outcome = await recordActivationEvent(managerIsPage ? "sas" : "self", { ...evBase, loan: isLoanAct });
      } else {
        stillInstalls.add(sasId);
        outcome = await recordCompanyActivation({ ...evBase, loan: isLoanAct, managerName: mgr || null });
      }
      // 🔓 الواقعةُ مُغلَقةٌ سلفاً ⇒ **غيرُ مصنَّفة**: يظهر فرقُ التاريخ في «تحديث معلومات»
      if (outcome === "closed" && !isLoanAct) return false;
      actedSasIds.add(sasId);
      return true;
    };

    // (toImport وpkgFixQueue أُزيلتا — الرصدُ في سجلّ المزامنة والتطبيقُ يدويّ. 2026-08-20)

    // ♻️ (seenSasIds/stillInstalls/stillDiffering مرفوعةٌ لنطاق الدالّة أعلاه)

    for (const u of allUsers) {
      seenSasIds.add(u.sasId);
      let p = progBySasId.get(u.sasId);
      // 🔗 يوزرٌ عندنا برقمِ ساسٍ جديد: **ليس تنصيباً** بل رقمُ حسابٍ تغيّر — يُرصَد ربطاً
      //    في «تحديث معلومات»، والاستبدالُ (تركَ الخدمة وحلَّ محلَّه آخر) صار فعلاً صريحاً
      //    بزرِّه لا نتيجةً جانبيّةً لزرّ «تحديث» (كان يؤرشف الصفَّ الصحيح ويُنشئ مكرَّراً).
      let sasLinkDiff: InfoChange | null = null;
      const sasDate = u.expiration ? new Date(u.expiration) : null;
      const validDate = sasDate && !isNaN(sasDate.getTime()) ? sasDate : null;

      if (!p) {
        // 🔗 يوزرٌ عندنا برقمِ ساسٍ جديد ⇒ **ربطٌ** لا تنصيب (بلاغُ محمد 2026-08-21):
        //    أعادت الشركةُ إنشاءَ حساب الساس (216391 ⇐ 491275 في حالة bg-13-6-3@mu)، فكان
        //    يُرصَد «تنصيباً خارجيّاً»، و«تحديث» عليه **يؤرشف صفَّك الصحيحَ ويُنشئ ثانياً**.
        //    الآن: يُصنَّف صفُّه القائمُ مرجعاً، ويُضاف فرقُ «رقم الساس» إلى تحديث المعلومات،
        //    والاستبدالُ الحقيقيُّ (تركَ الخدمة وحلَّ محلَّه آخر) زرُّه صريحٌ منفصل.
        const uKey = (u.username ?? "").trim().toLowerCase();
        const oldByUser = uKey ? progByUser.get(uKey) : undefined;
        if (oldByUser) {
          dupUserSkipped++;
          p = oldByUser;
          sasLinkDiff = {
            f: "sasLink", label: "🔗 رقمُ الساس تغيّر (أعادت الشركةُ إنشاءَ الحساب)",
            old: String(oldByUser.sasId ?? "—"), new: String(u.sasId),
          };
          await closeDeadSasRows(officeId, oldByUser.sasId, u.sasId);
        } else {
          // ═════ 📋 مشترك جديد في الساس ⇒ **لا استيرادَ تلقائيّاً** (قرار محمد 2026-08-20):
          // يُرصَد في تبويب «تنصيب خارجي» بكامل بياناته، و«حفظ» بيد صاحب الصلاحيّة يستورده
          // (بلا وصل)، و«تجاهل» يخفيه حتى تتغيّر بياناتُه.
          stillInstalls.add(u.sasId);
          const fresh = await recordInstall({
            agentId: office.agentId ?? -1, towerId: officeId, sasId: u.sasId, subscriberId: null,
            netUser: u.username, name: u.name, phone: u.phone, address: u.address,
            packageName: u.packageName, sasDateTo: validDate,
          });
          if (fresh && autoMsg.install) {
            await sendSyncLogMessage("install", {
              towerId: officeId, sasId: u.sasId, subscriberId: null, phone: u.phone,
              netUser: u.username, name: u.name, packageName: u.packageName, sasDateTo: validDate,
            });
          }
          continue;
        }
      }
      // ═════ 📋 سجلّ المزامنة (قرار محمد 2026-08-20): «تمديدُ التاريخ وحدَه يبقى تلقائيّاً» ═════
      // كانت المزامنةُ تكتب العنوانَ مباشرةً (ادرس 1) وتردم الهاتفَ الفارغَ وتملأ الباقةَ
      // الفارغة — كلُّ ذلك صار **رصداً** في تبويب «تحديث معلومات» والتطبيقُ بيد صاحب
      // صلاحيّة «تحديث سجل المزامنة». الرصدُ قبل كلّ حارسٍ (بياناتُ تواصلٍ تُرى حتى لصاحب قرض).
      {
        const diffs: InfoChange[] = [];
        const sv = (x: string | null | undefined) => (x ?? "").trim();
        // ═════ 🎁 باقةُ الساس «عرض» ⇒ **لا يُطلَب تحديثُ معلوماتٍ إطلاقاً** (قاعدةُ محمد
        // 2026-08-21 المكمَّلة): «سواءٌ كان في البرنامج بلا باقةٍ أو بباقةٍ مختلفة — فقط
        // يُقارَن أينطبق عليه تنصيبٌ خارجيٌّ أم لا». والعلّةُ أنّ بياناتِ فترة العرض
        // **مؤقّتةٌ بطبيعتها** (باقةٌ وتاريخٌ سيتغيّران بعد انتهائه)، فرصدُها ضجيجٌ يزول.
        // 🔑 ويُستثنى شيئان لأنّهما ليسا «معلوماتِ مشترك» بل **هويّةُ حسابه**، وبهما وحدَهما
        //    تعرف المزامنةُ مَن هو: تغيّرُ اليوزر · وتغيّرُ رقم الساس (الذي كان يُنتج
        //    مشتركين مكرَّرين). وما عداهما يُسكَت عنه ما دام على عرض.
        const sasOffer = isOfferPackage(u.packageName);
        if (sasLinkDiff) diffs.push(sasLinkDiff); // 🔗 أوّلُ الفروق: رقمُ الحساب نفسُه
        // 🔴 **تغيّرُ اليوزر في الساس — أخطرُ تغييرٍ على الإطلاق** (بلاغ محمد 2026-08-21):
        // الشركةُ تُعيد تسميةَ يوزرٍ فيبقى صفُّنا بالاسم القديم بينما رقمُه يشير لصاحبٍ آخر
        // (حالة bg-7-4-2@mu ← bg-7-5-1@mu)، فتُفتح صفحةُ ساسٍ لغير صاحبها، ويبدو اليوزرُ
        // الحقيقيُّ «مستورداً سلفاً» فلا يدخل البرنامج أبداً. وكانت المقارنةُ لا تشمل
        // اليوزرَ إطلاقاً — واليوزرُ هو الفيصلُ الذي لا يُخطئ. يُرصَد أوّلاً وبعلامةٍ حمراء.
        if (sv(u.username) && sv(u.username).toLowerCase() !== sv(p.netUser).toLowerCase()) {
          diffs.push({ f: "netUser", label: "🔴 اليوزر تغيّر في الساس", old: sv(p.netUser) || "—", new: sv(u.username) });
        }
        if (!sasOffer && sv(u.phone) && sv(u.phone) !== sv(p.phone)) diffs.push({ f: "phone", label: "الهاتف", old: sv(p.phone) || "—", new: sv(u.phone) });
        if (!sasOffer && sv(u.name) && sv(u.name) !== sv(p.name) && !nameCoversSas(p.name, u.name)) {
          diffs.push({ f: "name", label: "الاسم", old: sv(p.name) || "—", new: sv(u.name) });
        }
        if (!sasOffer && sv(u.address) && sv(u.address) !== sv(p.address)) diffs.push({ f: "address", label: "العنوان", old: sv(p.address) || "—", new: sv(u.address) });
        const sasPkgIdForDiff = matcher.match(u.packageName);
        const oursPkgName = p.packageId != null ? (pkgNameById.get(p.packageId) ?? `#${p.packageId}`) : "—";
        // 📦 (ب) **لا يُرصَد فرقُ باقةٍ لا يعرف البرنامجُ مقابلَها** (`match` تعود null):
        // الرصدُ كان يُنتج صفّاً **لا يمكن تطبيقُه أبداً** (البرنامجُ لا يُنشئ باقةً — قاعدةٌ
        // قديمة)، فيُتجاهل فيُعاد إنشاؤه في المزامنة التالية… دورةٌ لا تنتهي. وباقةٌ
        // مجهولةٌ تظهر أصلاً في عدّاد `skippedPkg` بتقرير المزامنة — بيتُها الصحيح.
        // 🎁 **بلا باقةٍ عندنا وباقتُه في الساس «عرض» ⇒ لا يُذكَر** (قاعدةُ محمد الجديدة
        //    2026-08-21): «بعد انقضاء فترة العرض سيُفعَّل بإحدى الباقات، وبقاؤه بلا باقةٍ
        //    لا يؤثّر على شيء». وهذه وحدَها كانت ١٥١ صفّاً في المواصلات.
        if (sv(u.packageName) && !sasOffer && sasPkgIdForDiff != null && sasPkgIdForDiff !== p.packageId) {
          diffs.push({ f: "package", label: "الباقة", old: oursPkgName, new: sv(u.packageName) });
        }
        // 📅 فرقُ الأيّام لمعلوم الباقة (قرار محمد 2026-08-21 المصحَّح): زيادةً **ونقصاً**
        // يُرصَد هنا والتطبيقُ يدويٌّ حصراً من التبويب — التمديدُ التلقائيُّ بقي لمجهول
        // الباقة وحدَه (أدناه). وصاحبُ القرض مستثنى: أيّامُه الوهميّةُ ليست فرقاً يُعرَض.
        // 🚫 لا فرقَ أيّامٍ لمن له تفعيلةُ ساسٍ في النافذة — بيتُها تبويبُ التفعيل لا المعلومات
        if (!sasOffer && sasPkgIdForDiff != null && !loanSubIds.has(p.id) && validDate && !actedSasIds.has(u.sasId)) {
          const oday = p.dateTo ? p.dateTo.toISOString().slice(0, 10) : "";
          const nday = validDate.toISOString().slice(0, 10);
          // 🕗 فرقٌ دون ١٢ ساعةً = عرفُ تخزينٍ لا تغييرُ اشتراك (٧ ساعاتٍ بين 17:00Z و00:00Z)
          if (oday !== nday && !sameExpiry(p.dateTo, validDate)) {
            const grew = !p.dateTo || validDate > p.dateTo;
            // 🎯 (د) الزيادةُ لها سببٌ دائماً — تفعيلةٌ وقعت خارج نافذة اليومَين. نسألُ
            //    الساسَ عنها فتُصنَّف في تبويبها الصحيح بدل «تمديدِ أيّامٍ» مجهولِ المصدر.
            //    (النقصُ لا يُسأل عنه: لا تفعيلةَ تُنقص تاريخاً — تصحيحٌ يدويٌّ من الشركة.)
            let classified = false;
            // 🚫 **لا ازدواجَ بين تبويبَين** (بلاغُ محمد 2026-08-21: bg-1-14-2@mu ظهر في
            //    «تفعيل خارجي» و«تحديث معلومات» معاً): صفُّ حدثٍ معلَّقٌ لهذا الرقم يعني
            //    أنّ بيتَ الواقعة تبويبُ التفعيل — فلا يُكرَّر فرقُ أيّامها هنا.
            if (!classified) {
              // 🔴 **الحارسُ يمنع تكرارَ الحدث نفسِه لا تفعيلاتِ المشترك إلى الأبد**
              //    (علّةٌ مقيسة 2026-08-22): كان أيُّ صفٍّ قديمٍ مختومٍ لهذا الرقم يُسكِت
              //    **كلَّ** قفزات التاريخ اللاحقة — فتفعيلُ اليوم لا يُصنَّف ولا يُرصَد
              //    (حالتا bg-53-10-3@shu وbg-63-8-1@res: فرقُ ٢٤ و٣٤ يوماً بلا صفٍّ في أيّ تبويب).
              //    الآن: يُطابَق الصفُّ بـ**تاريخ الانتهاء الذي أنتجه** (±١٢ ساعة) — فهو بصمةُ
              //    الواقعة نفسِها؛ وصفٌّ بلا تاريخٍ يُقبَل حارساً ثلاثةَ أيّامٍ فقط.
              const expLo = validDate ? new Date(validDate.getTime() - EXP_TOL_MS) : null;
              const expHi = validDate ? new Date(validDate.getTime() + EXP_TOL_MS) : null;
              // 🔴 **والحارسُ يمنع الازدواجَ لا يبتلع الفرق** (قرارُ محمد 2026-08-22):
              //    «اعتُبر معالَجاً» يُغلق صفَّ الحدث **ولا يمسّ التاريخ**، وكان الحارسُ بعدها
              //    يُسكِت فرقَ الأيّام إلى الأبد — فبقيت تواريخُ مشتركين متأخّرةً ٢٤ و٣١ و٣٤
              //    يوماً وهم فعّالون (تصلهم رسالةُ انتهاءٍ ظلماً). الآن: **المعلَّقُ وحدَه**
              //    يُسكِت (فلا يظهر في تبويبَين معاً)، وما أُغلق يعود فرقَ تاريخٍ في
              //    «تحديث معلومات» تضغط عليه «تحديث» فيُصحَّح. والمُطبَّقُ لا يعود أصلاً —
              //    فتاريخُنا صار مطابقاً فلا فرقَ يُرصَد.
              const openEvent = await prisma.syncLog.findFirst({
                where: {
                  towerId: officeId, sasId: u.sasId, kind: { in: ["sas", "self", "install"] },
                  status: "pending",
                  activatedAt: { not: null },
                  ...(expLo && expHi
                    ? {
                        OR: [
                          { sasDateTo: { gte: expLo, lte: expHi } },
                          { sasDateTo: null, activatedAt: { gte: new Date(Date.now() - 3 * 86400_000) } },
                        ],
                      }
                    : {}),
                },
                select: { id: true },
              }).catch(() => null);
              if (openEvent) classified = true; // نفسُ الواقعة (معلَّقةً كانت أو مختومة)
            }
            // 💸 **آخرُ تفعيلةٍ بمبلغ صفرٍ ⇒ قرضٌ ⇒ لا فرقَ تاريخٍ أبداً** (بلاغُ محمد
            //    2026-08-21: bg-1-14-2@mu «ومن مثله»): أيّامُ القرض ليست أيّاماً مدفوعةً
            //    ولا تغييرَ معلومات — والدليلُ في تقرير التفعيلات نفسِه: سعرُ صفر.
            //    وتُقرَأ من **نافذة التفعيلات المفهرَسة** فلا يهمّ أوقع التفعيلُ في نافذة
            //    اليومَين أم قبلها بشهر.
            // 🎯 كلُّ اختلافِ تاريخٍ يُسأل عنه الساسُ مباشرةً (زيادةً ونقصاً): مَن المنجر؟
            //    كم المبلغ؟ فيُصنَّف في تبويبه، أو يتبيّن أنّه قرضٌ (صفر) فيُسكَت عنه.
            // 💰 ونقصُ الأيّام **لا يُرصَد إذا كان تاريخُنا مدفوعاً بوصل** (حالة bg-5-12-11@mu:
            //    وصلُ ٤٥ ألفاً حتى ٢٠-١٠ والساسُ يقول ٣٠-٨ لأنّ الشركةَ تُعطي ١٠ أيّامٍ ثمّ
            //    تُكمل ٥٠). تطبيقُه كان **يقصّ أيّاماً مقبوضةً**، فالسكوتُ عنه هو الصواب.
            if (!classified && !grew && p.dateTo) {
              const paid = await receiptsOfUser((u.username ?? p.netUser ?? "").trim().toLowerCase(), p.id);
              if (paid.to.some((t) => Math.abs(t - p.dateTo!.getTime()) <= RECEIPT_NEAR_MS)) classified = true;
            }
            if (!classified) {
              classified = await classifyDateJump(p, u.sasId, u.username, validDate);
            }
            if (!classified) {
              // ⚠️ (هـ) نقصٌ يتجاوز أسبوعاً: تطبيقُه **يقصّ أيّاماً مدفوعةً** من مشترك،
              //    فيُوسَم خطراً — تُبرزه الواجهةُ بالأحمر وتستثنيه من «تحديد الكلّ».
              const lostDays = grew || !p.dateTo ? 0
                : Math.round((p.dateTo.getTime() - validDate.getTime()) / 86400000);
              diffs.push({
                f: "dateTo",
                label: grew ? "تاريخ الانتهاء (زيادة أيّام)" : `تاريخ الانتهاء (نقص أيّام: ${lostDays})`,
                old: oday || "—", new: nday,
                ...(lostDays > 7 ? { danger: true } : {}),
              });
            }
          }
        }
        if (diffs.length) stillDiffering.add(u.sasId); // ما زال فرقٌ قائم ⇒ يبقى في التبويب
        await recordInfoDiff({
          agentId: office.agentId ?? -1, towerId: officeId, sasId: u.sasId, subscriberId: p.id,
          netUser: u.username, name: u.name, phone: u.phone, address: u.address,
          packageName: u.packageName, sasDateTo: validDate,
        }, diffs);
        // 🪦 **قاعدةُ «باقة العرض = إعادةُ خدمة» أُلغيت** (قياسٌ حيٌّ 2026-08-21): سوبر سيل
        // تُسمّي باقاتِها العاديّةَ نفسَها «Offer-50Mbps + (60 Days)» — فكانت القاعدةُ ترمي
        // **كلَّ مشتركٍ عاديٍّ** في تبويب «تنصيب خارجي» (٨ من ٩ صفوفٍ كانت كاذبةً في قياس
        // حساب محمد). ولا خسارةَ في إلغائها: إعادةُ الخدمة من الشركة تظهر أصلاً حدثاً في
        // تبويبَي «تفعيل خارجي/تفعيلات ساس» بمالها وتاريخها — وهو الرصدُ الصحيح.
      }
      // صاحب قرضٍ قائم ⇒ لا تلمسه المزامنة إطلاقاً (لا تاريخ ولا باقة ولا عدّ) حتى يُسدَّد
      // بالتفعيل العاديّ فيُمحى قرضه ويعود طبيعيّاً.
      if (loanSubIds.has(p.id)) continue;
      // 📅 قاعدةُ الأيّام (قرار محمد 2026-08-21 المصحَّح — انقلابُ الأدوار):
      //   · **معلومُ الباقة**: لا لمسَ تلقائيّاً إطلاقاً — فرقُ أيّامه (زيادةً ونقصاً) دُفع
      //     أعلاه إلى تبويب «تحديث معلومات» والتطبيقُ بيد صاحب الصلاحيّة حصراً.
      //   · **مجهولُ الباقة** (باقةُ عرضٍ/غيرُ مضافة/بلا اسم): يُمدَّد تلقائيّاً **للأمام
      //     فقط** — حالةُ المنصَّب بعرض ١٠ أيّامٍ ثمّ تضيف الشركةُ ٥٠ (لا تقصيرَ أبداً).
      const sasPkgId = matcher.match(u.packageName);
      if (sasPkgId == null) {
        if (validDate && sasDateIsLater(p.dateTo, validDate)) {
          // البند ٤-أ · وتُمسَح رايةُ «أُبلِغ بانتهائه» مع التمديد — فبقاؤها يمنع رسالةَ
          // انتهائه القادمَ إلى الأبد (التطبيقُ اليدويُّ لمعلوم الباقة يمسحها في مساره).
          await prisma.subscriber.update({ where: { id: p.id }, data: { dateTo: validDate, expiredNoticeAt: null } });
          dateFixed++;
        }
        // مسمّاةٌ ومجهولةٌ عندنا ⇒ تُحصى للتقرير (بلا اسمٍ أصلاً لا تُحصى — لا فئةَ لها)
        if ((u.packageName ?? "").trim()) skippedPkg++;
        continue;
      }
      checked++;
    }

    // ═════ ♻️ التصحيحُ الذاتيُّ للسجلّ (شرط محمد 2026-08-21) ═════
    // «إذا وجد أنّ شيئاً أُصلح في المزامنة التالية يحدّث نفسه معها ويُبقي ما تبقّى».
    // يُغلق ما رأيناه هذه الدورةَ ولم يعد مؤهَّلاً: تنصيبٌ استُورد صاحبُه، ومعلوماتٌ تطابقت،
    // وصفوفٌ ولّدتها قواعدُ أُلغيت (كقاعدة «Offer» الكاذبة). ولا يُغلق ما لم نره.
    const closedInstalls = await reconcileInstalls(officeId, seenSasIds, stillInstalls);
    const closedInfo = await reconcileInfo(officeId, seenSasIds, stillDiffering);
    // 💰 وصفوفُ الأحداث تُصالَح بالوصل **مهما قدُم تفعيلُها** (لا تُشترَط رؤيتُها في النافذة)
    const closedEvents = await reconcileEvents(officeId, (u, id, at, to) => collectedByUs(u, id, at, to));
    // 🎴 وحالاتُ «الكارت المسروق» تُغلق نفسَها متى ظهر وصلٌ لصاحبها (±٣ أيّام)
    const closedStolen = await reconcileStolenCards(officeId, (u, id, at) => receiptNearCard(u, id, at));
    if (closedInstalls || closedInfo || closedEvents || closedStolen) {
      console.log(`[sync-log] ♻️ مكتب ${officeId}: أُغلق تلقائيّاً ${closedInstalls} تنصيباً و${closedInfo} تحديثَ معلومات و${closedEvents} حدثَ تفعيلٍ بوصلٍ عندنا و${closedStolen} حالةَ كارتٍ مسروقٍ ظهر وصلُها`);
    }

    // 📋 الاستيرادُ الجماعيُّ وملءُ الباقات الفارغة **انتقلا إلى سجلّ المزامنة** (2026-08-20):
    // «حفظ» في تبويب التنصيب يستورد، و«تحديث» في تبويب المعلومات يربط الباقة — بيد
    // صاحب صلاحيّة «تحديث سجل المزامنة» لا تلقائيّاً. (toImport/pkgFixQueue حُذفتا.)
  } catch (e) {
    // 🔴 **كان `catch {}` أعمى** (بلاغُ صميم 2026-08-13): يُرفَع `failed: true` **بلا أيّ
    // سبب**، فيرى الوكيلُ «خطأً» لا يدلّ على شيء ولا نعرف نحن أين تعثّر. وقد وقع فعلاً:
    // رابطُ لوحتَي صميم كان خطأً فسقط الدخولُ إلى الساس، والمزامنةُ قالت «فشل» وسكتت —
    // فاستُهلك وقتٌ في التخمين وحُذف ٢١٧٢ مشتركاً ظنّاً أنّ البياناتَ هي العلّة.
    // والقاعدة: **لا تُبتلَع علّةٌ يراها مستخدمٌ كخطأ** — إمّا تُعالَج أو تُروى.
    phase2Failed = true; // ولا نُسقط نتائج المرحلة 1
    phase2Error = e instanceof Error ? e.message : String(e);
  }

  // ===================== التقرير =====================
  const result: SyncResult = {
    office: officeName,
    phase1: { activations: acts.length, internal, external, phantom, markedUsed, duplicates, imported, verifiedReal, dupUserPhase1 },
    phase2: { checked, dateFixed, imported: phase2Imported, failed: phase2Failed, skippedPkg, pkgFixed, dupUserSkipped, probesCapped, stolenCards },
    events, reportSent: null,
    // السببُ يُحمَل إلى الحالة المخزَّنة فتراه الواجهةُ ويُقرأ من القاعدة عند التشخيص
    ...(phase2Error ? { error: phase2Error } : {}),
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
  if (r.phase2.pkgFixed > 0) text += `🏷️ رُبطت باقاتهم وأسعارها: ${r.phase2.pkgFixed} مشترك\n`;
  if ((r.phase1.dupUserPhase1 ?? 0) > 0) text += `
🔗 تفعيلٌ رُبط بصفّ اليوزر القائم بدل إنشاء صفٍّ مكرَّر: ${r.phase1.dupUserPhase1}`;
  if ((r.phase2.dupUserSkipped ?? 0) > 0) text += `
⚠️ يوزرٌ موجودٌ سلفاً فلم يُستورَد (يحتاج قرارك): ${r.phase2.dupUserSkipped}`;
  if (r.phase2.skippedPkg > 0) text += `⏭️ تُركوا بلا تعديل (فئتهم غير مضافة بالبرنامج): ${r.phase2.skippedPkg} مشترك\n`;
  if (r.phase2.imported > 0) text += `🆕 استيراد شامل من الساس: ${r.phase2.imported} مشترك\n`;
  // 🔴 حالاتُ الكارت المسروق وسقفُ المسبار — **يُعلَنان ولا يُبتلَعان** (شرطُ محمد: لا صمت)
  if ((r.phase2.stolenCards ?? 0) > 0) text += `🔴 كروتٌ من مخزنك فُعِّلت بلا وصل (في حارس المال): ${r.phase2.stolenCards}\n`;
  if ((r.phase2.probesCapped ?? 0) > 0) text += `⏳ قفزاتُ تاريخٍ لم تُصنَّف (بلغ سقفُ السؤال المباشر): ${r.phase2.probesCapped}\n`;

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
  stolen?: number;          // 🔴 كروتُ مخزنٍ فُعِّلت بلا وصلٍ لصاحبها (قاعدةُ محمد 2026-08-22)
  stolenOld?: number;       // منها أقدمُ من ٣٠ يوماً — تُحصى ولا تُرفَع (كي لا يُغرَق حارسُ المال)
  phantom: number;          // منها لم توجد في SAS ⇒ وهمية جديدة
  errors: number;           // كروت تعذّر فحصها (تعثّر SAS) — لم يُحكم عليها
  aborted: boolean;         // أوقف الفحص مبكراً (إلغاء أو تعثّر SAS)
  skippedOld: number;       // كروت استُخدمت قبل نافذة الفحص — لا يُحكم عليها
  windowDays: number;       // عمق النافذة المفحوصة بالأيام
  events: SyncEvent[];
  error?: string;
}

// حالة المزامنة اليدوية — في قاعدة البيانات لتصمد عبر النسخ المتعددة وإعادة التشغيل
export type ManualSyncStatus = {
  state: "running" | "done" | "error";
  step?: "sync" | "cards" | "report";
  progress?: { label: string; done: number; total: number }; // مؤشّر تقدّم مرئي للمستخدم
  cancel?: boolean; // طلب إلغاء — تفحصه الحلقات وتتوقّف بنظافة
  startedAt: string;
  // 💓 نبضةُ الحياة: تُحدَّث كلَّ دقيقةٍ ما دامت المزامنةُ **تعمل فعلاً**. وبها يُعرَف
  //   الميّتُ من البطيء — ولولاها لبقيت الحالةُ «جارية» إلى الأبد إن مات صاحبُها.
  beatAt?: string;
  finishedAt?: string;
  sync?: SyncResult;
  cards?: FullCardsResult | null;
  error?: string;
};

const manualStatusKey = (officeId: number) => `manualSync:${officeId}`;

export async function setManualSyncStatus(officeId: number, st: ManualSyncStatus): Promise<void> {
  const type = manualStatusKey(officeId);
  // 💓 كلُّ كتابةٍ نبضةٌ: فمَن يكتب حالتَه حيٌّ بالتعريف
  const text = JSON.stringify({ ...st, beatAt: st.beatAt ?? new Date().toISOString() });
  // `orderBy` صريحٌ: لا فهرسَ فريداً على `type` (وفي الإنتاج مفتاحٌ مكرَّرٌ فعلاً)، فبلاه
  // يقرأ صفّاً ويكتب آخرَ فتضيع الحالةُ بلا سبب ظاهر. وأصغرُ مُعرِّفٍ هو الصفُّ الحاكم.
  const row = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true }, orderBy: { id: "asc" } });
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
}

/** بعد هذه المدّة بلا نبضةٍ تُعتبَر المزامنةُ **منقطعة** (مات صاحبُها) لا بطيئة. */
export const MANUAL_SYNC_DEAD_MS = 5 * 60 * 1000;
/** فاصلُ النبض — أقصرُ بكثيرٍ من مهلة الموت فلا تُدان مزامنةٌ حيّةٌ بتأخُّرِ نبضةٍ واحدة. */
const MANUAL_SYNC_BEAT_MS = 60 * 1000;

/** 💓 نبضةٌ جرّاحيّةٌ: تُحدّث `beatAt` **وحدَه** داخل النصّ بلا قراءةِ الحالةِ وكتابتها.
 *  ولماذا لا نقرأ-فنكتب؟ لأنّ الحلقةَ تكتب `progress` في اللحظة نفسِها — فنبضةٌ ساذجةٌ
 *  تطمس تقدُّمَها فيرى محمد المؤشّرَ يرتدّ إلى الوراء. و`jsonb_set` يمسّ مفتاحاً واحداً.
 *  وتُقيَّد بـ`state='running'` كي لا تُحيي حالةً انتهت. */
async function beatManualSync(officeId: number): Promise<void> {
  const type = manualStatusKey(officeId);
  // ⚠️ والصيغةُ **ISO بـ`Z` صريحة** لا `::text` الافتراضيّة: تلك تُخرج «مسافةً بلا منطقة»
  //   (`2026-08-13 18:47:42.3`) وتُقرأ في جافاسكربت **بتوقيتٍ محلّيّ** — فبغدادُ UTC+3
  //   تجعل النبضةَ تبدو في المستقبل بثلاث ساعات، فلا تُدان مزامنةٌ ميّتةٌ أبداً وتعود
  //   العُقدةُ نفسُها من بابٍ آخر. (وهذا ما اصطدتُه قبل النشر لا بعده.)
  await prisma.$executeRaw`
    UPDATE system_settings
       SET text = jsonb_set(text::jsonb, '{beatAt}',
             to_jsonb(to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))::text
     WHERE id = (SELECT id FROM system_settings WHERE type = ${type} ORDER BY id ASC LIMIT 1)
       AND text::jsonb ->> 'state' = 'running'`;
}

export async function getManualSyncStatus(officeId: number): Promise<ManualSyncStatus | null> {
  const row = await prisma.systemSetting.findFirst({
    where: { type: manualStatusKey(officeId) }, select: { text: true }, orderBy: { id: "asc" },
  });
  if (!row?.text) return null;
  let st: ManualSyncStatus | null = null;
  try { st = JSON.parse(row.text) as ManualSyncStatus; } catch { return null; }
  if (!st) return null;

  // ═════ 🔴 حصادُ المزامنةِ المنقطعة (بلاغُ محمد عن صفاء 2026-08-13) ═════
  // الحادثة: مكتبُ صفاء بقي `running` **٧٥ ساعةً** — لا تنتهي ولا تتوقّف. والسببُ
  // بنيويٌّ لا عارض: الحالةُ تُكتب «جارية» في القاعدة، ثمّ يموت صاحبُها (نشرةٌ جديدةٌ،
  // إعادةُ تشغيل، انهيار) — **وليس في الشيفرة شيءٌ يحصد راية**. فتبقى إلى الأبد:
  //   • الواجهةُ تستطلع فترى «جارية» ⇒ دوّارةٌ لا تقف، وزرُّ «مزامنة الآن» **مُعطَّل**.
  //   • وزرُّ «إيقاف» يرفع `cancel: true` — والإلغاءُ **تعاونيّ**، فلا حلقةَ حيّةً تقرؤه.
  //   ⇒ لا تنتهي ولا تتوقّف ولا تُبدأ من جديد. عُقدةٌ مُحكَمة.
  // 🔑 والحلُّ نبضةٌ لا مهلةٌ من البداية: `startedAt` لا يُفرّق بين مزامنةٍ طويلةٍ حيّةٍ
  //   وأخرى ميّتة، أمّا انقطاعُ النبض فدليلُ موتٍ قاطع.
  // وتُكتب النتيجةُ **مرّةً واحدةً** فتشفى الحالةُ ذاتيّاً لكلّ من يفتح الصفحة بعدها.
  if (st.state === "running") {
    const last = new Date(st.beatAt ?? st.startedAt).getTime();
    if (Number.isFinite(last) && Date.now() - last > MANUAL_SYNC_DEAD_MS) {
      const mins = Math.round((Date.now() - last) / 60000);
      const dead: ManualSyncStatus = {
        state: "error", startedAt: st.startedAt, finishedAt: new Date().toISOString(),
        error: `انقطعت المزامنة (توقّف الخادم أو أُعيد نشرُه) — بلا أثرٍ منها منذ ${mins} دقيقة. اضغط «🔄 مزامنة الآن» لإعادتها.`,
      };
      await setManualSyncStatus(officeId, dead).catch(() => {});
      return dead;
    }
  }
  return st;
}

/** مهلةُ اعتبارِ المزامنةِ عالقةً — بعدها يُسمح ببدءٍ جديدٍ ولو بقيت الحالةُ «جارية». */
const MANUAL_SYNC_STALE_MS = 30 * 60 * 1000;

/** ═════ ب-١/الأصل ٥ · حَجزُ المزامنة اليدويّة ذرّيّاً ═════
 *  🔴 كان المسارُ **فحصاً ثمّ كتابة**: يقرأ الحالةَ، فإن لم تكن «جارية» يكتبها ويُطلق.
 *    وبين القراءة والكتابة نافذةٌ: ضغطتان متقاربتان (أو مديران) ⇒ **مزامنتان** على
 *    المكتب نفسِه: جلبُ ١٢٠ يوماً مرّتَين، **وتقريرُ واتسابٍ كاملٌ يصل المديرَ مرّتَين**.
 *  ⇒ الحجزُ صار **مقارنةً وتبديلاً** (CAS): نُحدّث الصفَّ بشرط أنّ نصَّه لم يتغيّر عمّا
 *    قرأناه. فمَن كتب أوّلاً يفوز، والثاني `count === 0` فينضمّ بلا إطلاق.
 *  @returns `joined: true` ⇒ هناك مزامنةٌ جاريةٌ (منّا أو من غيرنا) فلا تُطلق ثانية. */
export async function claimManualSync(officeId: number): Promise<{ claimed: boolean; joined: boolean }> {
  const type = manualStatusKey(officeId);
  const row = await prisma.systemSetting.findFirst({
    where: { type }, select: { id: true, text: true }, orderBy: { id: "asc" },
  });
  let cur: ManualSyncStatus | null = null;
  if (row?.text) { try { cur = JSON.parse(row.text) as ManualSyncStatus; } catch { cur = null; } }
  if (cur?.state === "running" && Date.now() - new Date(cur.startedAt).getTime() < MANUAL_SYNC_STALE_MS) {
    return { claimed: false, joined: true };
  }
  const next = JSON.stringify({ state: "running", step: "sync", startedAt: new Date().toISOString() } as ManualSyncStatus);

  if (!row) {
    // أوّلُ مزامنةٍ لهذا المكتب: لا صفَّ نُقارنه. ولا فهرسَ فريداً على `type` ⇒ متسابقان
    // قد يُنشئان صفَّين. فالحسمُ بقاعدةٍ قاطعةٍ: **أصغرُ مُعرِّفٍ يفوز**، والخاسرُ يحذف صفَّه.
    const made = await prisma.systemSetting.create({ data: { type, text: next }, select: { id: true } });
    const all = await prisma.systemSetting.findMany({ where: { type }, select: { id: true }, orderBy: { id: "asc" } });
    if (all[0]?.id !== made.id) {
      await prisma.systemSetting.delete({ where: { id: made.id } }).catch(() => {});
      return { claimed: false, joined: true };
    }
    return { claimed: true, joined: false };
  }

  const won = await prisma.systemSetting.updateMany({
    where: { id: row.id, text: row.text }, data: { text: next },
  });
  return won.count === 1 ? { claimed: true, joined: false } : { claimed: false, joined: true };
}

// فحص كل مخزون كروت الوكيل مقابل SAS — بجلب جماعي لتفعيلات SAS ثم مطابقة محلّية.
// (كان استعلاماً منفصلاً لكل كارت: 423 استعلاماً × ~5 ثوانٍ ≈ 45 دقيقة. الآن ~10 طلبات.)
// نافذة الفحص: آخر CARD_AUDIT_DAYS يوماً — الكارت المستخدم قبلها لا يُحكم عليه بالوهمية
// لأن تفعيله خارج ما جلبناه، والحكم عليه يكون إيجاباً كاذباً يُرجع كارتاً حقيقياً للمخزون.
const CARD_AUDIT_DAYS = 120;

/** أدنى عددٍ من الكروت المستخدمة يجب فحصُه قبل أن يُعتبَر «صفرُ مُثبَتٍ» بصمةَ عطبٍ لا حقيقة.
 *  ثلاثةٌ: فحصُ كارتٍ أو اثنَين لا يكفي دليلاً في أيّ من الاتجاهَين، ولا يُعطَّل به اكتشافٌ صحيح. */
const PHANTOM_MIN_VERIFIED_SAMPLE = 3;

export async function runFullCardAudit(
  officeId: number,
  onProgress?: (label: string, done: number, total: number) => Promise<boolean>,
): Promise<FullCardsResult> {
  const empty: FullCardsResult = {
    checkedAvailable: 0, markedUsed: 0, checkedUsed: 0, verifiedReal: 0, stolen: 0,
    phantom: 0, errors: 0, aborted: false, skippedOld: 0, windowDays: CARD_AUDIT_DAYS, events: [],
  };
  const office = await prisma.tower.findUnique({
    where: { id: officeId },
    select: { id: true, name: true, agentId: true },
  });
  // ═════ 🔴 الجردُ يقرأ **كلَّ لوحات المكتب** (بلاغُ محمد 2026-08-13) ═════
  // كان يقرأ `credsOfTower` = **اللوحةَ الأولى وحدَها**. والكارتُ في مخزن **المكتب** لا في
  // لوحةٍ بعينها — فكارتٌ فُعِّل على اللوحة الثانية لا تفعيلَ له في قائمة الأولى، فيُحكَم
  // عليه بالوهميّة **وهو مستخدَمٌ حقّاً**. وقِيس على الإنتاج: جردُ صميم يجلب ٢٤٩ تفعيلاً
  // من «صميم١» بينما «صميم٢» وحدَها فيها ~١٠٠١ ⇒ ألفُ دليلٍ غائبٍ عن الحكم.
  if (!office) return { ...empty, error: "المكتب غير موجود" };
  const scopes: SasCreds[] = [];
  for (const p of await panelsOfTower(officeId)) { const cc = credsFromPanel(p); if (cc) scopes.push(cc); }
  if (!scopes.length) {
    const fallback = await credsOfTower(officeId); // بلا لوحاتٍ: أعمدةُ المكتب — السلوكُ القديم
    if (fallback) scopes.push(fallback);
  }
  if (!scopes.length) return { ...empty, error: "المكتب لا يحتوي بيانات SAS كاملة" };

  const since = new Date(Date.now() - CARD_AUDIT_DAYS * 86400 * 1000);

  // 1) جلب تفعيلات كلِّ لوحةٍ ثمّ دمجُها (صفحات 500) مع تقدّم مرئي وإمكان الإلغاء
  const acts: SasActivation[] = [];
  let complete = true; // 🔑 ناقصةٌ من **أيّ** لوحةٍ ⇒ الغيابُ لا يُثبت شيئاً
  // جلساتُ اللوحات تُحفَظ للتحقّق المُوجَّه بالسيريال أدناه (بحثٌ لكلّ مشتبَهٍ على حِدة)
  const sessions: { base: string; token: string; label: string }[] = [];
  for (const sc of scopes) {
    let base: string, token: string;
    try {
      base = sasBaseUrl(sc.loginUrl);
      token = await sasLogin(base, sc.username, sc.password);
      sessions.push({ base, token, label: sc.label ?? "لوحة" });
    } catch (e) {
      // لوحةٌ تعذّر الدخولُ إليها = أدلّةٌ غائبة ⇒ لا يُحكَم بغيابِ ما لم نره
      return { ...empty, error: `فشل الاتصال بـ SAS${sc.label ? ` (${sc.label})` : ""}: ${(e as Error).message}` };
    }
    try {
      const label = scopes.length > 1 ? `جلب تفعيلات SAS — ${sc.label ?? "لوحة"}` : "جلب تفعيلات SAS";
      const r = await sasFetchActivationsSince(base, token, since, async (fetched, total) =>
        onProgress ? onProgress(label, fetched, total) : true,
      );
      acts.push(...r.rows);
      if (!r.complete) complete = false;
    } catch (e) {
      return { ...empty, error: (e as Error).message || "تعذّر جلب تفعيلات SAS" };
    }
  }

  // خريطة السيريال (pin) → تفعيله في SAS
  const actByPin = new Map<string, SasActivation>();
  for (const a of acts) {
    const pin = (a.pin ?? "").trim();
    if (pin && !actByPin.has(pin)) actByPin.set(pin, a);
  }

  const agentId = office.agentId ?? -1;
  const cards = await prisma.rechargeCard.findMany({
    where: { agentId },
    // `number` يُجلَب للبحث الاحتياطيّ: بعضُ الدفعات يُسجّل الساسُ رقمَها لا سيريالَها
    select: { id: true, serial: true, useDate: true, subscriberId: true, number: true },
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
  const flaggedSince = new Date(Date.now() - 120 * 86400 * 1000);
  const flagged = new Set(
    (await prisma.auditLog.findMany({
      where: { action: "SYNC_PHANTOM_VERIFIED", createdAt: { gte: flaggedSince } },
      select: { entityId: true },
    })).map((a) => Number(a.entityId)).filter((n) => Number.isFinite(n)),
  );

  // مشتركو SAS المذكورون في التفعيلات (لربط الكارت بصاحبه عند تعليمه مستخدماً)
  const sasIds = [...new Set(acts.map((a) => a.sasUserId).filter((x): x is number => x != null))];
  const subsBySasId = new Map(
    (sasIds.length
      ? await prisma.subscriber.findMany({
          where: { sasId: { in: sasIds }, isDeleted: false },
          select: { id: true, sasId: true, name: true, netUser: true },
        })
      : []
    ).map((s) => [s.sasId as number, s]),
  );

  // 🔑 خريطةُ اليوزر (الفيصلُ الذي لا يُخطئ) — تُستعمل قبل خريطة الرقم عند ربط الكارت
  const subsByUser = new Map(
    officeSubs
      .filter((s) => (s.netUser ?? "").trim())
      .map((s) => [(s.netUser as string).trim().toLowerCase(), s]),
  );

  const res: FullCardsResult = { ...empty };

  // ═════ 🎴 قاعدةُ الوصل في الجرد أيضاً (إملاءُ محمد 2026-08-22) ═════
  // ولماذا هنا أيضاً؟ لأنّ الجردَ الليليَّ يمرّ على **١٢٠ يوماً**، فلو عُلِّم الكارتُ
  // مستخدماً هنا بصمتٍ لأطفأ أثرَ السرقة الذي ترفعه المزامنةُ اليوميّة — أو لما رُفعت
  // أصلاً لكارتٍ فُعِّل قبل نافذة اليومين. القاعدةُ واحدةٌ في الموضعَين بلا استثناء.
  // 🔒 ولا يُتَّهم كارتٌ **مبيعٌ أو مُفعَّلٌ بيد إنسان**: هذا الفرعُ لا يدخله إلّا كارتٌ
  //    حالتُه «متاح» في البرنامج (‏useDate فارغ) — أي لم يستهلكه أحدٌ عندنا أصلاً.
  const AUDIT_RECEIPT_MS = 3 * 86400_000;
  const AUDIT_GRACE_MS = 24 * 3600_000;
  // ⏳ **سقفُ عمرٍ للحالات في الجرد وحدَه**: نافذتُه ١٢٠ يوماً، فأوّلُ تشغيلٍ بعد النشر كان
  //    سيرفع تاريخَ المخزن كلَّه دفعةً واحدةً فيُغرِق حارسَ المال. الحديثُ (٣٠ يوماً) يُرفَع،
  //    والأقدمُ **يُحصى ويُقال عددُه** في التقرير — فلا شيءَ يُبتلَع بصمت.
  //    (والمزامنةُ اليوميّةُ بلا هذا السقف: نافذتُها يومان أصلاً.)
  const AUDIT_MAX_AGE_MS = 30 * 86400_000;
  const auditIdsByUser = new Map<string, number[]>();
  for (const os of officeSubs) {
    const uk = (os.netUser ?? "").trim().toLowerCase();
    if (!uk) continue;
    const l = auditIdsByUser.get(uk) ?? [];
    l.push(os.id);
    auditIdsByUser.set(uk, l);
  }
  const auditRecCache = new Map<string, number[]>();
  const auditHasReceipt = async (userKey: string, subId: number | null, at: Date): Promise<boolean> => {
    const key = userKey || "#" + String(subId ?? 0);
    let arr = auditRecCache.get(key);
    if (!arr) {
      const ids = auditIdsByUser.get(userKey) ?? (subId != null ? [subId] : []);
      const rows = ids.length
        ? await prisma.subscriptionEntry.findMany({
            where: { subscriberId: { in: ids }, isDeleted: false },
            select: { date: true }, orderBy: { id: "desc" }, take: 60,
          })
        : [];
      arr = rows.map((r) => r.date?.getTime() ?? 0).filter(Boolean);
      auditRecCache.set(key, arr);
    }
    return arr.some((t) => Math.abs(t - at.getTime()) <= AUDIT_RECEIPT_MS);
  };
  /** كارتُ مخزنٍ عُلِّم مستخدماً هنا: أله وصلٌ في ±٣ أيّام؟ وإلّا فحالةُ سرقةٍ في حارس المال */
  const auditJudge = async (
    act: SasActivation,
    serial: string,
    owner: { id: number; name: string | null; netUser: string | null } | null | undefined,
    when: Date,
  ): Promise<void> => {
    const uKey = String(act.username ?? owner?.netUser ?? "").trim().toLowerCase();
    if (await auditHasReceipt(uKey, owner?.id ?? null, when)) return;
    if (Date.now() - when.getTime() < AUDIT_GRACE_MS) return;
    if (Date.now() - when.getTime() > AUDIT_MAX_AGE_MS) { res.stolenOld = (res.stolenOld ?? 0) + 1; return; }
    const amount = Math.round(act.price || 0);
    const who = act.username ?? owner?.netUser ?? "—";
    const mgr = (act.managerUsername ?? "—").trim();
    const at = when.toISOString().slice(0, 16).replace("T", " ");
    await recordStolenCardCase({
      agentId, towerId: officeId, sasId: act.sasUserId,
      subscriberId: owner?.id ?? null,
      netUser: act.username ?? owner?.netUser ?? null,
      name: act.name ?? owner?.name ?? null,
      activatedAt: when, pins: [serial], amount,
      detail: "🔴 كارتٌ **من مخزنك** (سيريال " + serial + ") وجده الجردُ مُفعَّلاً في الساس ليوزر " + who
        + " بمبلغ " + amount + " بمنجر " + mgr + " بتاريخ " + at
        + " — **ولا وصلَ له عندك في ±٣ أيّام**.",
    });
    res.stolen = (res.stolen ?? 0) + 1;
  };

  // ═════ قاعدةُ محمد (2026-08-14): «مستخدَمٌ ثبت بالسيريال لا يُعاد فحصُه ولا يُوسَم أبداً» ═════
  // الحكمُ الدائم في `card_sas_checks`: كارتٌ وجده الساسُ يوماً (match أو mismatch — كلاهما
  // يعني أنّ الساس يعرفه فليس وهميّاً) يُحتسب مُثبَتاً فوراً بلا أيّ نداءِ ساس. فجردُ مكتبٍ
  // قائمتُه فقيرة (المواصلات: تفعيلاتُ التطبيق لا تظهر فيها) يدفع كلفةَ البحث الموجَّه
  // **مرّةً واحدةً في العمر** لا في كلّ مزامنة. والحذفُ من هذا الجدول لا يحدث بتغيير حالةٍ —
  // فالكارتُ المستهلَكُ استُهلك للأبد، وتحوُّلُ مُثبَتٍ إلى وهميٍّ عطبُ فحصٍ لا حقيقة.
  const provenReal = new Set(
    (await prisma.cardSasCheck.findMany({
      where: { agentId, verdict: { in: ["match", "mismatch"] } },
      select: { serial: true },
    })).map((x) => x.serial),
  );
  /** تخزينُ حكمِ «مُثبَتٌ حقيقيّ» الدائم — أفضلُ جهدٍ لا يُفشل الجرد */
  const storeProven = async (
    cardId: number, serial: string, subscriberId: number | null, netUser: string | null,
    hit: SasActivation | null,
  ) => {
    const sasUsername = hit?.username ?? null;
    const verdict = !sasUsername
      ? "match" // وُجد في القائمة بلا اسمٍ مرافق — الوجودُ نفسُه هو الإثبات
      : !netUser
        ? "mismatch"
        : (sasUsername.trim().toLowerCase() === netUser.trim().toLowerCase() ? "match" : "mismatch");
    const data = {
      agentId, serial, cardId, subscriberId,
      sasUsername, sasName: hit?.name ?? null, sasMethod: hit?.method ?? null,
      sasCreatedAt: hit?.createdAt ?? null, sasOldExpiry: hit?.oldExpiration ?? null,
      sasNewExpiry: hit?.newExpiration ?? null,
      sasPrice: typeof hit?.price === "number" ? hit.price : null,
      verdict, checkedAt: new Date(),
    };
    provenReal.add(serial);
    await prisma.cardSasCheck.upsert({
      where: { agentId_serial: { agentId, serial } }, create: data, update: data,
    }).catch(() => {});
  };

  // مرشَّحو الوهميّة — تُجمَع ثمّ يُحكَم عليها **بعد** تقييم صلاحيّة الأدلّة (أدناه)
  const candidates: { cardId: number; serial: string; subLabel: string; usedAt: string; subscriberId: number | null; netUser: string | null }[] = [];
  // 🔎 كروتٌ «متاحةٌ» عندنا ولم تُذكر في قائمة تفعيلات المكتب — تُبحَث بسيريالها فرداً فرداً
  const availUnmatched: { id: number; serial: string; number: string | null }[] = [];

  // 2) المطابقة المحلّية — بلا أي استعلام SAS إضافي
  let i = 0;
  for (const c of cards) {
    // تقدّم كل 50 كارتاً + فحص طلب الإلغاء
    if (++i % 50 === 0 && onProgress) {
      const go = await onProgress("مطابقة الكروت", i, cards.length);
      if (!go) { res.aborted = true; break; }
    }
    const serial = (c.serial ?? "").trim();
    if (!serial) continue;
    const hit = actByPin.get(serial);

    if (c.useDate == null) {
      // متاح بالبرنامج: هل استُخدم في SAS؟ (وجوده في التفعيلات كافٍ — لا حكم سلبي هنا)
      res.checkedAvailable++;
      // 🔎 لم تُذكر تفعيلتُه في قائمة المكتب ⇒ يُبحَث عنه **بسيرياله** لاحقاً (أدناه)
      if (!hit) { availUnmatched.push({ id: c.id, serial, number: c.number ?? null }); continue; }
      const when = hit.createdAt ? new Date(hit.createdAt) : new Date();
      // 🔑 الربطُ **باليوزر أوّلاً ثمّ بالرقم** (بلاغ محمد 2026-08-21): رقمُ الساس قد يكون
      // مغلوطاً على صفٍّ (حالة bg-7-4-2@mu) فيُربَط الكارتُ بمشتركٍ خاطئ أو لا يُربَط —
      // واليوزرُ هو الفيصلُ الذي لا يُخطئ. فإن عرفنا يوزرَ التفعيلة اعتمدناه.
      const hitUser = (hit.username ?? "").trim().toLowerCase();
      const sub = (hitUser ? subsByUser.get(hitUser) : null)
        ?? (hit.sasUserId != null ? subsBySasId.get(hit.sasUserId) : null);
      await prisma.rechargeCard.update({
        where: { id: c.id },
        data: {
          useDate: isNaN(when.getTime()) ? new Date() : when,
          subscriberId: sub?.id ?? null, userName: "sync",
          reservedBy: null, reservedAt: null,
        },
      });
      res.markedUsed++;
      await auditJudge(hit, serial, sub, isNaN(when.getTime()) ? new Date() : when);
      res.events.push({
        scenario: 3, subscriber: sub?.name ?? sub?.netUser ?? null, pin: serial,
        detail: "فحص شامل: الكارت مستخدم في SAS — حُدّث إلى مستخدم",
      });
      continue;
    }

    // مستخدم بالبرنامج: يُحكم عليه فقط إن كان لمشترك هذا المكتب ولم يُعلَّم وهمياً سابقاً
    if (c.subscriberId == null) continue;
    const sub = officeSubById.get(c.subscriberId);
    if (!sub || flagged.has(c.id)) continue;

    // 🔑 مُثبَتٌ من جردٍ سابق (قاعدة محمد): يُحتسب سليماً فوراً — صفرُ نداءاتٍ وصفرُ احتمالِ وسم
    if (provenReal.has(serial)) { res.checkedUsed++; res.verifiedReal++; continue; }

    // الحكم بالوهمية يتطلّب جلباً مكتملاً واستخداماً داخل النافذة — وإلا فالغياب لا يعني شيئاً
    if (!complete) { res.errors++; continue; }
    if (c.useDate < since) { res.skippedOld++; continue; }

    res.checkedUsed++;
    if (hit) {
      res.verifiedReal++;
      // وُجد في القائمة ⇒ يُخلَّد الإثباتُ فلا يُفحَص في أيّ جردٍ قادم
      await storeProven(c.id, serial, c.subscriberId, sub.netUser ?? null, hit);
      continue;
    }

    // ⏳ لا يُوسَم الآن: الحكمُ يُؤجَّل حتى يُعرَف **هل الأدلّةُ صالحةٌ أصلاً** (أدناه)
    candidates.push({
      cardId: c.id, serial,
      subLabel: sub.name ?? sub.netUser ?? String(c.subscriberId),
      usedAt: c.useDate ? new Date(c.useDate).toISOString() : "؟",
      subscriberId: c.subscriberId, netUser: sub.netUser ?? null,
    });
  }

  // ═════ 🔎 بحثٌ موجَّهٌ بالسيريال للكروت **المتاحة** (بلاغ محمد 2026-08-21) ═════
  // «كارتٌ مستخدَمٌ في الساس بقي في المتاحة ولم يجده أيُّ شيء» — والسببُ أنّ المطابقةَ
  // الجماعيّة تعتمد **قائمةَ تفعيلات حساب المكتب**، وهي لا تُظهر ما فُعِّل من حسابٍ فرعيٍّ
  // أو من تطبيق المشترك (نفسُ سبب إنذارات الوهميّة الكاذبة المقيسة 2026-08-13). فالبحثُ
  // بالسيريال (search) يغطّي الشجرةَ كاملةً — وكان مقصوراً على المشتبَه بوهميّتها.
  // 🔒 والكلفةُ محكومة: دفتَرُ `card_sas_checks` يحفظ حكمَ «غيرُ مستخدَم» بختمِ وقتٍ، فلا
  //    يُعاد بحثُ الكارت نفسِه قبل أسبوع، وسقفُ الجولة ٣٠٠ بحثٍ بأربعة تيّاراتٍ متوازية.
  if (availUnmatched.length && sessions.length) {
    const RECHECK_MS = 7 * 86400 * 1000;
    const MAX_AVAIL_VERIFY = 300;
    const AV_POOL = 4;
    const recent = new Map(
      (await prisma.cardSasCheck.findMany({
        where: { agentId, verdict: "unused", serial: { in: availUnmatched.map((x) => x.serial) } },
        select: { serial: true, checkedAt: true },
      }).catch(() => [])).map((x) => [x.serial, x.checkedAt?.getTime() ?? 0]),
    );
    const due = availUnmatched
      .filter((x) => Date.now() - (recent.get(x.serial) ?? 0) > RECHECK_MS)
      .slice(0, MAX_AVAIL_VERIFY);
    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= due.length) break;
        const { id, serial, number } = due[i];
        // يُبحَث بالسيريال في كلّ لوحة، ثمّ **برقم الكارت** إن اختلف (بعضُ الدفعات يُسجّل
        // الساسُ رقمَها لا سيريالَها) — وأيُّ تعذّرٍ في أيّ محاولةٍ يُلغي الحكمَ السلبيّ.
        let found: SasActivation | null = null;
        let probeOk = true;
        const keys = [serial, ...(number && number.trim() && number.trim() !== serial ? [number.trim()] : [])];
        outer: for (const key of keys) {
          for (const s of sessions) {
            const pr = await sasProbeSerial(s.base, s.token, key);
            if (!pr.ok) { probeOk = false; continue; }
            if (pr.hit) { found = pr.hit; break outer; }
          }
        }
        // 🛑 تعذّر الفحصُ ولم نجد ⇒ لا حكمَ ولا ختمَ في الدفتر (يُعاد في الجولة القادمة)
        if (!found && !probeOk) continue;
        if (!found) {
          // ليس مستخدَماً في الساس فعلاً ⇒ يُختَم في الدفتر كي لا يُبحَث كلَّ ليلة
          await prisma.cardSasCheck.upsert({
            where: { agentId_serial: { agentId, serial } },
            create: { agentId, serial, cardId: id, verdict: "unused", checkedAt: new Date() },
            update: { cardId: id, verdict: "unused", checkedAt: new Date() },
          }).catch(() => {});
          continue;
        }
        // مستخدَمٌ فعلاً — يُعلَّم ويُربَط **باليوزر أوّلاً** (الرقمُ قد يكذب)
        const hu = (found.username ?? "").trim().toLowerCase();
        const owner = (hu ? subsByUser.get(hu) : null) ?? (found.sasUserId != null ? subsBySasId.get(found.sasUserId) : null);
        const when = found.createdAt ? new Date(found.createdAt) : new Date();
        await prisma.rechargeCard.update({
          where: { id },
          data: {
            useDate: isNaN(when.getTime()) ? new Date() : when,
            subscriberId: owner?.id ?? null, userName: "sync",
            reservedBy: null, reservedAt: null,
          },
        }).catch(() => {});
        res.markedUsed++;
        await auditJudge(found, serial, owner, isNaN(when.getTime()) ? new Date() : when);
        res.events.push({
          scenario: 3, subscriber: owner?.name ?? found.username ?? null, pin: serial,
          detail: "بحثٌ بالسيريال: الكارت مستخدمٌ في الساس (خارج قائمة المكتب) — حُدّث إلى مستخدم",
        });
        await storeProven(id, serial, owner?.id ?? null, owner?.netUser ?? null, found);
      }
    };
    await Promise.all(Array.from({ length: Math.min(AV_POOL, due.length) }, worker));
    if (due.length) console.log(`[card-audit] 🔎 مكتب ${officeId}: بُحث بالسيريال عن ${due.length} كارتٍ متاح — عُلّم مستخدماً ${res.markedUsed}`);
  }

  // ═════ 🛑 «لا حكمَ بغيابِ دليلٍ لم يثبت أنّه يحضر» (بلاغُ محمد 2026-08-13) ═════
  // البلاغ: صفحةُ الكروت الوهميّة تُرجع **كروتاً مستخدمةً حقّاً**، وضغطةُ «ربط» تربطها
  // بمشتركيها وتزيلها — أي أنّها لم تكن وهميّةً قطّ. تكرّر لأكثرِ من وكيلٍ وحتى شكيب.
  //
  // 🎯 وقياسُ الإنتاج كشف بصمةً قاطعة: **١١ من ١١** تشغيلاً وسم كروتاً كان فيه «سليم ٠»
  //   — لم يُثبِت **ولا كارتاً واحداً** أنّه حقيقيّ. وفي المقابل ٥٥ تشغيلاً أثبت كروتاً
  //   ولم يسم شيئاً. والفصلُ تامّ. (وأكبرها: المواصلات ٨٦٧ كارتاً في تشغيلٍ واحد، ثمّ
  //   ٢٦٦ — ومجموعُ ما وُسِم ظلماً وما زال قائماً ٥٣٦ كارتاً.)
  //
  // 🔑 والاستنتاج: «كلُّ كروتِ المكتب المستخدمةِ وهميّة» ليس خبراً عن الكروت بل عن
  //   **مصدرِ الأدلّة**: قائمةُ التفعيلات لم تصل كما يجب (حسابٌ فرعيٌّ لا يرى تفعيلاتِ
  //   غيره · صفحاتٌ ناقصة · نافذة). والغيابُ لا يُثبت العدمَ إلّا إن أثبت الحضورُ نفسَه.
  // ⇒ فإن لم يُثبَت ولا كارتٌ واحدٌ بينما فُحصت ثلاثةٌ أو أكثر: **لا يُوسَم شيء**، ويُرفَع
  //   خطأٌ ظاهرٌ للمدير. فخسارةُ اكتشافٍ صحيحٍ أهونُ من قائمةٍ كاذبةٍ يُنظّفها محمد بيده
  //   — وهي كلفةٌ وقعت فعلاً ٥٣٦ مرّة.
  // ═════ 🎯 تحقّقٌ مُوجَّهٌ بالسيريال قبل أيّ حكم (حسمُ سبب البلاغ 2026-08-13) ═════
  // شرحُ محمد حسم المسألة: **كلُّ تفعيلٍ بكارت**، لكنّ الكارتَ يُفعَّل بثلاثة طرق:
  //   ١. المشتركُ يُفعّل لنفسه من **تطبيق سوبر سيل** ⇒ يظهر التفعيلُ باسم موقعه
  //      (`FDT13-MU` مثلاً) لا باسم حساب المكتب.
  //   ٢. يأتي إلى المكتب فيُفعّل المكتبُ ⇒ يظهر باسم حساب الساس للمكتب.
  //   ٣. وتفعيلاتُ الديلر (٩٠ يوماً).
  // ⇒ فقائمةُ تفعيلات حساب المكتب **لا تحمل كلَّ ما استُخدم من كروته**، وهذا ليس عطباً
  //   بل سياسةُ سوبر سيل: «موجودٌ لكن لا يمكن استخدامه».
  //
  // 🔑 والدواءُ كان في البرنامج سلفاً ولم يستعمله هذا الجرد: `sasSearchActivation` تبحث
  //   **بالسيريال مباشرةً** فتجد التفعيل مهما كان تاريخُه ومَن أجراه — وهي بعينها سرُّ
  //   نجاح زرّ «ربط» الذي كان محمد يُصلح به ما وسمناه ظلماً. والمرحلةُ الأولى تستعملها
  //   منذ زمن؛ أمّا الجردُ الشاملُ فكان يحكم بقائمةٍ ناقصةٍ وحدَها.
  // ⇒ فلا يُوسَم كارتٌ إلّا بعد أن يفشل **البحثُ الموجَّه عنه في كلّ لوحات مكتبه**.
  //   وبهذا يصير الجردُ صادقاً كصدق زرّ «ربط»، ويُستغنى عن التخمين بالنسب والطرق.
  // ═════ قاعدةُ محمد (2026-08-14): «لا وسمَ وهميّةٍ لكارتٍ لم يُفحَص بسيريالِه — مهما كان العدد» ═════
  // 🔴 حادثةُ اليوم بعينها: المواصلات ٦٣٦ مشتبهاً — فُحص ٥٠٠ فثبتت **كلُّها** حقيقيّةً، ثمّ
  //   وُسم الفائضُ ١٣٦ بلا فحصٍ لأنّ السقف انقضى. فالسقفُ رُفع بما يغطّي أكبرَ مكتبٍ بأضعاف،
  //   والفائضُ عنه — إن وُجد يوماً — **لا يُوسَم أبداً**: يُحتسب خطأً ظاهراً ويُفحَص في الجرد
  //   القادم (والتخزينُ الدائمُ أعلاه يجعل كلَّ جردٍ يبدأ ممّا فوق المفحوص، فالطابورُ ينفد).
  const MAX_VERIFY = 2000;
  const POOL = 4;         // طلباتٌ متزامنةٌ خفيفةٌ على الساس (صفٌّ واحدٌ لكلّ بحث)
  const toVerify = candidates.slice(0, MAX_VERIFY);
  const overflow = candidates.slice(MAX_VERIFY); // فوق السقف: لا يُبرَّأ ولا يُدان — يُؤجَّل
  const foundReal = new Array<boolean>(toVerify.length).fill(false);
  const foundHit = new Array<SasActivation | null>(toVerify.length).fill(null);
  let vNext = 0;
  const verifyWorker = async () => {
    for (;;) {
      const i = vNext++;
      if (i >= toVerify.length) break;
      for (const s of sessions) { // 🔒 لوحاتُ **هذا** المكتب حصراً
        const hit = (await sasProbeSerial(s.base, s.token, toVerify[i].serial)).hit;
        if (hit) { foundReal[i] = true; foundHit[i] = hit; break; }
      }
    }
  };
  if (toVerify.length) {
    if (onProgress) await onProgress("تحقّقٌ مباشرٌ من المشتبَه بها", 0, toVerify.length);
    await Promise.all(Array.from({ length: Math.min(POOL, toVerify.length) }, verifyWorker));
  }
  const stillSuspect: typeof candidates = [];
  for (let i = 0; i < toVerify.length; i++) {
    if (foundReal[i]) {
      res.verifiedReal++; // وُجد بالبحث الموجَّه ⇒ حقيقيٌّ لا وهميّ
      // ويُخلَّد الإثباتُ — فلا يُبحَث سيريالُه في أيّ جردٍ قادمٍ أبداً (قاعدة محمد)
      const cand = toVerify[i];
      await storeProven(cand.cardId, cand.serial, cand.subscriberId, cand.netUser, foundHit[i]);
    } else stillSuspect.push(toVerify[i]);
  }
  if (overflow.length) {
    res.errors += overflow.length;
    res.events.push({
      scenario: 1, subscriber: null, pin: null,
      detail: `⏳ ${overflow.length} كارتاً فوق سقف التحقّق (${MAX_VERIFY}) — لم يُفحَص فلا يُوسَم، ويُستكمل في الجرد القادم`,
    });
  }
  const rescued = foundReal.filter(Boolean).length; // عددُ ما أنقذه البحثُ الموجَّه
  if (rescued > 0) {
    res.events.push({
      scenario: 3, subscriber: null, pin: null,
      detail: `تحقّقٌ مباشر: ${rescued} كارتاً غائباً عن قائمة التفعيلات وُجد بالبحث بالسيريال — فليس وهميّاً (وخُلِّد إثباتُه)`,
    });
  }
  candidates.length = 0;
  candidates.push(...stillSuspect);

  const evidenceBroken = res.verifiedReal === 0 && res.checkedUsed >= PHANTOM_MIN_VERIFIED_SAMPLE;
  if (evidenceBroken) {
    res.errors += candidates.length;
    res.error = `تعذّر التحقّق من الكروت: فُحص ${res.checkedUsed} كارتاً مستخدماً ولم يُثبَت أيٌّ منها — لا بقائمة التفعيلات ولا بالبحث المباشر`
      + ` (${acts.length} تفعيلاً${scopes.length > 1 ? ` من ${scopes.length} لوحات` : ""})`
      + ` — وهذا يدلّ على نقصٍ في قائمة التفعيلات لا على كروتٍ وهميّة، فلم يُدرَج شيء.`;
    res.events.push({
      scenario: 1, subscriber: null, pin: null,
      detail: `فحص شامل: لم يُوسَم شيء — ${candidates.length} كارتاً كانت ستُدرَج ظلماً (بلا أيّ كارتٍ مُثبَتٍ في SAS)`,
    });
  } else {
    for (const cand of candidates) {
      await prisma.auditLog.create({
        data: {
          action: "SYNC_PHANTOM_VERIFIED", entity: "rechargeCard", entityId: String(cand.cardId),
          details: `كارت وهمي (فحص شامل بجلب تفعيلات SAS): سيريال ${cand.serial} — مشترك ${cand.subLabel} — مكتب ${office.name ?? officeId} — استُخدم ${cand.usedAt}`,
        },
      });
      flagged.add(cand.cardId);
      res.phantom++;
      res.events.push({
        scenario: 1, subscriber: cand.subLabel, pin: cand.serial,
        detail: "فحص شامل: مستخدم بالبرنامج بلا تفعيل في SAS — أُدرج بالكروت الوهمية",
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      action: "SYNC_FULL_CARDS", entity: "tower", entityId: String(officeId),
      details: `فحص شامل للكروت — ${office.name ?? officeId}: تفعيلات SAS ${acts.length} (نافذة ${CARD_AUDIT_DAYS} يوماً) · متاح ${res.checkedAvailable} (حُدّث ${res.markedUsed}) · مستخدم ${res.checkedUsed} (سليم ${res.verifiedReal} · وهمي ${res.phantom})` +
        (res.skippedOld ? ` · تُرك ${res.skippedOld} أقدم من النافذة` : "") +
        (res.errors ? ` · تعذّر الحكم على ${res.errors}` : "") +
        (res.aborted ? " · أُوقف بطلب الإلغاء" : ""),
    },
  });
  return res;
}

// نصّ تقرير المزامنة اليدوية الكامل: تقرير المزامنة + قسم فحص الكروت
function buildManualReportText(sync: SyncResult, cards: FullCardsResult | null): string {
  const day = iraqYesterdayRange(new Date()).start;
  let text = buildReportText(sync, day, "تقرير المزامنة اليدوية");
  // سؤالُ محمد: «هل مرّت على الساسَين؟» — يُقال صريحاً في التقرير، ونجاحاً وفشلاً.
  // ولوحةٌ سقطت تُصدَّر بـ⛔ لا بصمتٍ: صمتُ النجاح كان يُشبه صمتَ الغياب تماماً.
  if (sync.panels && sync.panels.length) {
    const ok = sync.panels.filter((p) => p.ok).length;
    const all = sync.panels.length;
    text += `\n\n🖥️ لوحاتُ الساس: ${ok}/${all}${ok === all ? " ✓" : " ⚠️"}\n`;
    text += sync.panels.map((p) =>
      p.ok
        ? `${all > 1 ? "• " : ""}${p.label}: تفعيلات ${p.activations} · مستوردون ${p.imported} · فُحص ${p.checked} · صُحِّح ${p.dateFixed}`
        : `⛔ ${p.label}: ${p.error ?? "لم تُزامَن"}`,
    ).join("\n");
    if (ok < all) text += `\n⚠️ لوحةٌ لم تُزامَن — أعِد المزامنةَ بعد إصلاح سببها.`;
  }
  if (cards) {
    text += `\n\n📇 فحص الكروت الشامل (كل المخزون):\n`;
    if (cards.error) {
      text += `⚠️ تعذّر الفحص: ${cards.error}`;
    } else {
      text += `متاح فُحص: ${cards.checkedAvailable} — حُدّث إلى مستخدم: ${cards.markedUsed}\n`;
      text += `مستخدم فُحص: ${cards.checkedUsed} — سليم: ${cards.verifiedReal} — وهمي جديد: ${cards.phantom}`;
      if ((cards.stolen ?? 0) > 0) text += `
🔴 كروتٌ من مخزنك فُعِّلت بلا وصل (حارس المال): ${cards.stolen}`;
      if ((cards.stolenOld ?? 0) > 0) text += `
ℹ️ ومثلُها أقدمُ من ٣٠ يوماً لم تُرفَع: ${cards.stolenOld}`;
      if (cards.phantom > 0) text += `\n🛡️ الوهمية تظهر في «الكروت الوهمية» بحسابات المدير لاتخاذ الإجراء.`;
      if (cards.skippedOld > 0) text += `\nℹ️ ${cards.skippedOld} كارت استُخدم قبل نافذة الفحص (${cards.windowDays} يوماً) — لم يُحكم عليه.`;
      if (cards.errors > 0) text += `\n⚠️ تعذّر الحكم على ${cards.errors} كارت.`;
      if (cards.aborted) text += `\n⏹️ أُوقف الفحص بطلب الإلغاء.`;
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
  // 💓 نبضةٌ كلَّ دقيقةٍ ما دُمنا أحياء — وهي **كلُّ الفرق** بين مزامنةٍ بطيئةٍ وأخرى ماتت.
  //   ولا تُفكّ إلّا في `finally`: فلو انتهت الدالّةُ بأيّ طريقٍ (نجاحٍ أو رميةٍ) توقّف
  //   النبضُ فوراً، ولو مات العمليّةُ كلُّها توقّف بموتها — وهو المطلوبُ بعينه.
  const beat = setInterval(() => { void beatManualSync(officeId).catch(() => {}); }, MANUAL_SYNC_BEAT_MS);
  try {
    await setManualSyncStatus(officeId, { state: "running", step: "sync", startedAt });

    // إن صادفت مزامنةً مجدولةً جارية (قفل داخلي): ننتظر وندخل بعدها بدل رسالة «الطلب المكرّر»
    let sync = await runOfficeSyncAll(officeId, { notify: false });
    for (let i = 0; i < 5 && sync.error?.includes("قيد التنفيذ"); i++) {
      await new Promise((r) => setTimeout(r, 25_000));
      sync = await runOfficeSyncAll(officeId, { notify: false });
    }

    if (sync.error) {
      await setManualSyncStatus(officeId, { state: "done", startedAt, finishedAt: new Date().toISOString(), sync, cards: null });
      return;
    }

    // ⏹ «ولا يمكنه إيقافها»: الإلغاءُ كان يُفحَص **داخل فحص الكروت وحدَه**، فمَن ضغط
    //   «إيقاف» في المرحلة الأولى (وهي الأطولُ: ١٢٠ يوماً من الساس) لا يُستجاب له
    //   إطلاقاً — بل يمضي البرنامجُ إلى فحصِ كلّ الكروت ثمّ تقريرِ واتساب. فصار الطلبُ
    //   يُحترَم عند **أوّل حدٍّ يُمكن الوقوفُ عنده**: قبل الدخول في المرحلة الثانية.
    const askedStop = await getManualSyncStatus(officeId);
    if (askedStop?.cancel) {
      await setManualSyncStatus(officeId, {
        state: "done", startedAt, finishedAt: new Date().toISOString(), sync, cards: null,
      });
      return;
    }

    await setManualSyncStatus(officeId, { state: "running", step: "cards", startedAt, sync });
    let cards: FullCardsResult;
    try {
      // تقدّم مرئي + احترام طلب الإلغاء (يُرجع false فتتوقّف الحلقة بنظافة)
      cards = await runFullCardAudit(officeId, async (label, done, total) => {
        const cur = await getManualSyncStatus(officeId);
        if (cur?.cancel) return false;
        await setManualSyncStatus(officeId, {
          state: "running", step: "cards", startedAt, sync,
          progress: { label, done, total },
        });
        return true;
      });
    } catch (e) {
      cards = {
        checkedAvailable: 0, markedUsed: 0, checkedUsed: 0, verifiedReal: 0, stolen: 0,
        phantom: 0, errors: 0, aborted: false, skippedOld: 0, windowDays: 0, events: [],
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
  } finally {
    clearInterval(beat); // 💓 يتوقّف النبضُ بانتهاء العمل — بأيّ طريقٍ انتهى
  }
}
