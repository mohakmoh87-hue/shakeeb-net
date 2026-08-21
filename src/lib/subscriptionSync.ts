import { prisma } from "@/lib/prisma";
import {
  sasBaseUrl, sasLogin, sasFetchActivationsForDay, sasFetchAllUsers, sasFindSerial,
  sasActivationWindow, actWindowFindSerial, type ActWindow,
  sasFetchActivationsSince,
  type SasActivation,
} from "@/lib/sas4";
import { sendViaProvider } from "@/lib/messaging";
import { formatDate } from "@/lib/format";
import { iraqYesterdayRange, iraqTodayRange } from "@/lib/dailyReport";
import { matcherForOffice } from "@/lib/packageMatch";
import { credsOfPanel, credsOfTower, panelsOfTower, credsFromPanel, type SasCreds } from "@/lib/sasPanel";
// 📋 سجلّ المزامنة (2026-08-20): المزامنةُ ترصد وتكتب في السجلّ، والتطبيقُ بيد صاحب الصلاحيّة
import { recordInfoDiff, recordInstall, recordActivationEvent, recordCompanyActivation, resolveEventIfReceipted, reconcileInstalls, reconcileInfo, closeDeadSasRows, isOwnCabinet, type InfoChange } from "@/lib/syncLog";
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
  phase2: { checked: number; dateFixed: number; imported: number; failed: boolean; skippedPkg: number; pkgFixed: number; dupUserSkipped?: number };
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
  const acts = actsWide.filter((a) => {
    const d = a.createdAt ? new Date(a.createdAt) : null;
    return d != null && !isNaN(d.getTime()) && d >= start && d <= end;
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

  // كروت **وكيل هذا المكتب فقط** (البِن → الكارت). كان بلا أي فلتر، والمزامنة تكتب على
  // الكارت المطابق (تستهلكه وتنسبه لمشترك) — أي أن مزامنة وكيل قد تستهلك كارت وكيل آخر
  // بمجرد تشابه السيريال. عزل مالي حرج اصطاده تدقيق 2026-08-02.
  const cards = await prisma.rechargeCard.findMany({
    where: { agentId: office.agentId ?? -1 },
    select: { id: true, serial: true, useDate: true, subscriberId: true },
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
  // 🪟 نافذةُ التفعيلات المفهرَسة (٣٥ يوماً) — **كسولةٌ**: لا تُجلَب إلّا عند أوّل سؤالٍ
  // حقيقيّ (فحصُ كارتٍ أو قفزةُ تاريخ)، فالمزامنةُ الهادئةُ لا تدفع ثمنَها. وهي البديلُ
  // الكاملُ لبحث الساس المعطَّل: تُجاب منها كلُّ الأسئلة بصفر نداءاتٍ إضافيّة.
  let actWinP: Promise<ActWindow> | null = null;
  const getActWin = () => (actWinP ??= sasActivationWindow(base, token, 35));
  const receiptCache = new Map<string, { at: number[]; to: number[] }>();
  const receiptsOfUser = async (userKey: string, fallbackSubId?: number) => {
    const k = userKey || `#${fallbackSubId ?? 0}`;
    const cached = receiptCache.get(k);
    if (cached) return cached;
    const ids = idsByUser.get(userKey) ?? (fallbackSubId != null ? [fallbackSubId] : []);
    let out = { at: [] as number[], to: [] as number[] };
    if (ids.length) {
      const rows = await prisma.subscriptionEntry.findMany({
        where: { subscriberId: { in: ids }, isDeleted: false },
        select: { date: true, dateTo: true },
        orderBy: { id: "desc" }, take: 60,
      });
      out = {
        at: rows.map((r) => r.date?.getTime() ?? 0).filter(Boolean),
        to: rows.map((r) => r.dateTo?.getTime() ?? 0).filter(Boolean),
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
      // كان `continue` يقفز فوق معالجة الكارت، فكارتٌ استُهلك في الساس ليوزرٍ ليس عندنا
      // يبقى «متاحاً» في المخزن إلى الأبد فيُسحب مرّةً ثانية. المشتركُ يُربَط لاحقاً عند
      // استيراده من السجلّ؛ أمّا كونُه مستهلَكاً فحقيقةٌ لا تنتظر أحداً.
      if (card && !card.useDate) {
        const when = a.createdAt ? new Date(a.createdAt) : new Date();
        await prisma.rechargeCard.update({
          where: { id: card.id },
          data: { useDate: isNaN(when.getTime()) ? new Date() : when, userName: "sync", reservedBy: null, reservedAt: null },
        });
        card.useDate = when;
        markedUsed++;
        events.push({ scenario: 3, subscriber: a.username ?? null, pin, detail: "كارتٌ استُهلك ليوزرٍ غير مستوردٍ بعد — عُلّم مستخدماً" });
      }
      continue;
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
    actedSasIds.add(a.sasUserId); // له تفعيلةٌ في النافذة ⇒ لا يُسجَّل «فرقُ أيّام» في تبويب المعلومات
    if (!sub) continue; // غيرُ مستوردٍ ⇒ تنصيبٌ جديدٌ ترصده المرحلةُ الثانية بكامل بياناته
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
    if (covered) { await resolveEventIfReceipted(officeId, a.sasUserId, actAt); continue; }
    // 💰 قاعدةُ محمد بحرفها: «إن كان لديه وصلُ تفعيلٍ عندي فليس خارجيّاً أبداً» —
    // وتُقاس على **اليوزر** (كلّ صفوفه) وبتاريخَين: قربُ الوصل من التفعيل، أو انتهاءُ
    // الوصل بانتهاء الساس نفسِه. (كانت على صفٍّ واحدٍ وبنافذة ±١٢ ساعةً وحدَها.)
    const subUserKey = (a.username ?? sub.netUser ?? "").trim().toLowerCase();
    if (await collectedByUs(subUserKey, sub.id, actAt, validNewExp)) {
      await resolveEventIfReceipted(officeId, a.sasUserId, actAt); continue;
    }
    // 💸 القرض (تصنيف محمد ٤): مبلغٌ صفرٌ **وبلا كارت** — يُوسَم كي لا يُصنع له وصلُ بيع
    const isLoanAct = Math.round(a.price || 0) <= 0 && !(a.pin ?? "").trim();
    if (managerIsPage || ownCabinet) {
      await recordActivationEvent(managerIsPage ? "sas" : "self", { ...evBase, loan: isLoanAct });
    } else {
      // ديلر/شركة ⇒ تبويب «تنصيب خارجي» حدثاً مؤرَّخاً (إعادةُ خدمةٍ من الشركة)
      stillInstalls.add(a.sasUserId);
      await recordCompanyActivation({ ...evBase, loan: isLoanAct, managerName: mgr || null });
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
      // 🪟 من النافذة المفهرَسة: بحثُ الساس بالسيريال **لا يعمل** (قياسُ 2026-08-21)،
      //    ونافذةٌ ناقصةٌ ⇒ يُعدّ «حقيقيّاً» احتياطاً فلا يُنذَر بالوهميّة على شكّ.
      const pr = actWindowFindSerial(await getActWin(), (toVerify[i].serial ?? "").trim());
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
      if (!newSasExp) return false;
      const win = await getActWin();
      const uKey = (username ?? sub.netUser ?? "").trim().toLowerCase();
      const cands = [...(win.bySasId.get(sasId) ?? []), ...(uKey ? win.byUser.get(uKey) ?? [] : [])];
      if (!cands.length) return false; // لا تفعيلةَ في النافذة ⇒ لا حكمَ (يبقى فرقَ تاريخ)
      // التفعيلةُ التي أنتجت تاريخَنا الجديد: انتهاؤها الجديد يطابق تاريخَ الساس (±١٢ ساعة)
      const hit = cands.find((r) => {
        const e = r.newExpiration ? new Date(r.newExpiration) : null;
        return sameExpiry(e, newSasExp);
      });
      if (!hit) return false;
      const actAt = hit.createdAt ? new Date(hit.createdAt) : null;
      if (!actAt || isNaN(actAt.getTime())) return false;
      // 💰 مقبوضٌ عندي (وصلٌ قريبٌ أو وصلٌ ينتهي بانتهائه) ⇒ ليس خارجيّاً — يبقى فرقَ تاريخ
      if (await collectedByUs(uKey, sub.id, actAt, newSasExp)) return false;
      const mgr = (hit.managerUsername ?? "").trim();
      const managerIsPage = mgr.toLowerCase() === officeUser;
      const ownCabinet = isOwnCabinet(hit.username ?? sub.netUser, mgr);
      const newExp = hit.newExpiration ? new Date(hit.newExpiration) : null;
      const evBase = {
        agentId: office.agentId ?? -1, towerId: officeId, sasId, subscriberId: sub.id,
        netUser: hit.username ?? sub.netUser, name: hit.name ?? sub.name,
        amount: Math.round(hit.price || 0), activatedAt: actAt,
        sasDateTo: newExp && !isNaN(newExp.getTime()) ? newExp : null,
      };
      const isLoanAct = Math.round(hit.price || 0) <= 0 && !(hit.pin ?? "").trim();
      if (managerIsPage || ownCabinet) {
        await recordActivationEvent(managerIsPage ? "sas" : "self", { ...evBase, loan: isLoanAct });
      } else {
        stillInstalls.add(sasId);
        await recordCompanyActivation({ ...evBase, loan: isLoanAct, managerName: mgr || null });
      }
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
        if (sasLinkDiff) diffs.push(sasLinkDiff); // 🔗 أوّلُ الفروق: رقمُ الحساب نفسُه
        // 🔴 **تغيّرُ اليوزر في الساس — أخطرُ تغييرٍ على الإطلاق** (بلاغ محمد 2026-08-21):
        // الشركةُ تُعيد تسميةَ يوزرٍ فيبقى صفُّنا بالاسم القديم بينما رقمُه يشير لصاحبٍ آخر
        // (حالة bg-7-4-2@mu ← bg-7-5-1@mu)، فتُفتح صفحةُ ساسٍ لغير صاحبها، ويبدو اليوزرُ
        // الحقيقيُّ «مستورداً سلفاً» فلا يدخل البرنامج أبداً. وكانت المقارنةُ لا تشمل
        // اليوزرَ إطلاقاً — واليوزرُ هو الفيصلُ الذي لا يُخطئ. يُرصَد أوّلاً وبعلامةٍ حمراء.
        if (sv(u.username) && sv(u.username).toLowerCase() !== sv(p.netUser).toLowerCase()) {
          diffs.push({ f: "netUser", label: "🔴 اليوزر تغيّر في الساس", old: sv(p.netUser) || "—", new: sv(u.username) });
        }
        if (sv(u.phone) && sv(u.phone) !== sv(p.phone)) diffs.push({ f: "phone", label: "الهاتف", old: sv(p.phone) || "—", new: sv(u.phone) });
        if (sv(u.name) && sv(u.name) !== sv(p.name) && !nameCoversSas(p.name, u.name)) {
          diffs.push({ f: "name", label: "الاسم", old: sv(p.name) || "—", new: sv(u.name) });
        }
        if (sv(u.address) && sv(u.address) !== sv(p.address)) diffs.push({ f: "address", label: "العنوان", old: sv(p.address) || "—", new: sv(u.address) });
        const sasPkgIdForDiff = matcher.match(u.packageName);
        const oursPkgName = p.packageId != null ? (pkgNameById.get(p.packageId) ?? `#${p.packageId}`) : "—";
        // 📦 (ب) **لا يُرصَد فرقُ باقةٍ لا يعرف البرنامجُ مقابلَها** (`match` تعود null):
        // الرصدُ كان يُنتج صفّاً **لا يمكن تطبيقُه أبداً** (البرنامجُ لا يُنشئ باقةً — قاعدةٌ
        // قديمة)، فيُتجاهل فيُعاد إنشاؤه في المزامنة التالية… دورةٌ لا تنتهي. وباقةٌ
        // مجهولةٌ تظهر أصلاً في عدّاد `skippedPkg` بتقرير المزامنة — بيتُها الصحيح.
        if (sv(u.packageName) && sasPkgIdForDiff != null && sasPkgIdForDiff !== p.packageId) {
          diffs.push({ f: "package", label: "الباقة", old: oursPkgName, new: sv(u.packageName) });
        }
        // 📅 فرقُ الأيّام لمعلوم الباقة (قرار محمد 2026-08-21 المصحَّح): زيادةً **ونقصاً**
        // يُرصَد هنا والتطبيقُ يدويٌّ حصراً من التبويب — التمديدُ التلقائيُّ بقي لمجهول
        // الباقة وحدَه (أدناه). وصاحبُ القرض مستثنى: أيّامُه الوهميّةُ ليست فرقاً يُعرَض.
        // 🚫 لا فرقَ أيّامٍ لمن له تفعيلةُ ساسٍ في النافذة — بيتُها تبويبُ التفعيل لا المعلومات
        if (sasPkgIdForDiff != null && !loanSubIds.has(p.id) && validDate && !actedSasIds.has(u.sasId)) {
          const oday = p.dateTo ? p.dateTo.toISOString().slice(0, 10) : "";
          const nday = validDate.toISOString().slice(0, 10);
          // 🕗 فرقٌ دون ١٢ ساعةً = عرفُ تخزينٍ لا تغييرُ اشتراك (٧ ساعاتٍ بين 17:00Z و00:00Z)
          if (oday !== nday && !sameExpiry(p.dateTo, validDate)) {
            const grew = !p.dateTo || validDate > p.dateTo;
            // 🎯 (د) الزيادةُ لها سببٌ دائماً — تفعيلةٌ وقعت خارج نافذة اليومَين. نسألُ
            //    الساسَ عنها فتُصنَّف في تبويبها الصحيح بدل «تمديدِ أيّامٍ» مجهولِ المصدر.
            //    (النقصُ لا يُسأل عنه: لا تفعيلةَ تُنقص تاريخاً — تصحيحٌ يدويٌّ من الشركة.)
            let classified = false;
            if (grew && dateProbes < MAX_DATE_PROBES) {
              dateProbes++;
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
    if (closedInstalls || closedInfo) {
      console.log(`[sync-log] ♻️ مكتب ${officeId}: أُغلق تلقائيّاً ${closedInstalls} تنصيباً و${closedInfo} تحديثَ معلومات (عولجت)`);
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
    phase2: { checked, dateFixed, imported: phase2Imported, failed: phase2Failed, skippedPkg, pkgFixed, dupUserSkipped },
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
    checkedAvailable: 0, markedUsed: 0, checkedUsed: 0, verifiedReal: 0,
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
            const pr = await sasFindSerial(s.base, s.token, key);
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
        const hit = (await sasFindSerial(s.base, s.token, toVerify[i].serial)).hit;
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
        checkedAvailable: 0, markedUsed: 0, checkedUsed: 0, verifiedReal: 0,
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
