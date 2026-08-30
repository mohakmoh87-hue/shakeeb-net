import { prisma } from "./prisma";
import { baghdadDayKey } from "./attendance";

// ═════ ⏰ الكرون الداخليّ (قرار محمد 2026-08-20: «إلغاء الكرون الليليّ بشكل كامل») ═════
// الموقعُ على Railway حيٌّ ٢٤ ساعة — فمهامُّ الليل الخمسُ انتقلت من مهمّة GitHub إلى
// دورةٍ داخليّةٍ كلَّ ٥ دقائق (نفس نمط ساحب البثّ في instrumentation.ts):
//   ١· بصمةُ الخروج التلقائيّة — **بوقتِ كلِّ فنيٍّ** (autoCheckoutTime) بدقّة ±٥ دقائق
//   ٢· الكتلةُ الليليّة (00:15): إنهاءُ الدعم النشط + تنظيفُ الأرشيف + تنبيهاتُ اشتراكات
//      الوكلاء + مزامنةُ SAS لكلّ المكاتب — بحَجزِ يومٍ بعُهدةٍ زمنيّة فلا تكرارَ ولا تفويت
//   ٣· ☁️ نسخةُ المالك الكاملة إلى Google Drive في وقتها المضبوط + إشعارُ حساب المالك وحدَه
// (نسخُ الوكلاء بالبريد ليست هنا عمداً: Railway يحجب SMTP فمُرسِلُها الفعليُّ مجدولُ
//  حاسبات المكاتب — كما كان قبل الإلغاء حرفيّاً.)

const NIGHTLY_AT_MIN = 15;            // 00:15 بغداد — موعد الكتلة الليليّة (كموعد الكرون القديم)
const NIGHTLY_TTL_MS = 60 * 60_000;   // عُهدة الكتلة الليليّة (المزامنة قد تطول دقائق)
const DRIVE_TTL_MS = 30 * 60_000;     // عُهدة رفعة درايف

function baghdadMinutes(now: Date): number {
  const b = new Date(now.getTime() + 3 * 3600 * 1000);
  return b.getUTCHours() * 60 + b.getUTCMinutes();
}

function baghdadHM(now: Date): string {
  const b = new Date(now.getTime() + 3 * 3600 * 1000);
  return `${String(b.getUTCHours()).padStart(2, "0")}:${String(b.getUTCMinutes()).padStart(2, "0")}`;
}

// ═════ حَجزُ يومٍ بعُهدةٍ زمنيّة — النمطُ المجرَّب في نسخة المالك (b818506) ═════
// `اليوم#pending#وقت` أثناء العمل، و`اليوم` الصريحُ بعد النجاح؛ عُهدةٌ بايتةٌ تُنتزَع.
type Claim = { claimed: boolean; rowId?: number; prev?: string | null };
async function claimDay(type: string, dayKey: string, ttlMs: number): Promise<Claim> {
  const last = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true, value: true }, orderBy: { id: "asc" } });
  if (last?.value === dayKey) return { claimed: false };
  if (last?.value?.startsWith(`${dayKey}#pending#`)) {
    const t = Number(last.value.split("#")[2]);
    if (Number.isFinite(t) && Date.now() - t < ttlMs) return { claimed: false };
  }
  const pend = `${dayKey}#pending#${Date.now()}`;
  if (last) {
    const won = await prisma.systemSetting.updateMany({ where: { id: last.id, value: last.value }, data: { value: pend } });
    return won.count === 1 ? { claimed: true, rowId: last.id, prev: last.value } : { claimed: false };
  }
  const made = await prisma.systemSetting.create({ data: { type, value: pend }, select: { id: true } });
  const all = await prisma.systemSetting.findMany({ where: { type }, select: { id: true }, orderBy: { id: "asc" } });
  if (all[0]?.id !== made.id) { await prisma.systemSetting.delete({ where: { id: made.id } }).catch(() => {}); return { claimed: false }; }
  return { claimed: true, rowId: made.id, prev: null };
}
const finalizeDay = (rowId: number, dayKey: string) =>
  prisma.systemSetting.update({ where: { id: rowId }, data: { value: dayKey } }).catch(() => {});
const releaseDay = (rowId: number, prev: string | null) =>
  prisma.systemSetting.update({ where: { id: rowId }, data: { value: prev } }).catch(() => {});

async function getSetting(type: string): Promise<string | null> {
  const r = await prisma.systemSetting.findFirst({ where: { type }, select: { value: true }, orderBy: { id: "asc" } });
  return r?.value?.trim() || null;
}

// إشعارُ حساب المالك **وحدَه** (ownerNotifyUserId — الافتراضيّ حسابُ shakeeb): جرسٌ مُخاطَبٌ
// بالمعرِّف (لا يراه بقيّةُ مستخدمي الوكيل) + دفعٌ لأجهزة ذلك الحساب فقط. لا بثَّ لوكيلٍ أبداً.
async function notifyOwner(title: string, body: string): Promise<void> {
  try {
    const uid = Number(await getSetting("ownerNotifyUserId"));
    if (!Number.isFinite(uid) || uid <= 0) return;
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, agentId: true } });
    if (!u) return;
    await prisma.notification.create({
      data: { agentId: u.agentId, towerId: null, type: "backup", title, body, userId: u.id },
    }).catch(() => {});
    const { sendPushToUser } = await import("./push");
    await sendPushToUser(u.id, { title, body }).catch(() => {});
  } catch { /* الإشعارُ أفضلُ جهدٍ — لا يُفشل النسخة */ }
}

// ═════ ٢ · الكتلة الليليّة ═════
async function nightlyBlock(todayKey: string): Promise<void> {
  const c = await claimDay("internalNightlyDate", todayKey, NIGHTLY_TTL_MS);
  if (!c.claimed || c.rowId == null) return;
  try {
    const { runAutoCheckout } = await import("./autoCheckout");
    const r = await runAutoCheckout({ resetSupport: true });
    const { purgeOldArchivedCards } = await import("./field");
    const purged = await purgeOldArchivedCards().catch(() => 0);
    const { runPlanWarnings } = await import("./planWarnings");
    const warns = await runPlanWarnings().catch(() => ({ checked: 0, notified: 0 }));
    // مزامنة SAS الليليّة (شبكة أمان سحابيّة) — مكتباً مكتباً، وفشلُ واحدٍ لا يوقف البقيّة
    const { runOfficeSyncAll } = await import("./subscriptionSync");
    const offices = await prisma.tower.findMany({ where: { isDeleted: false, syncEnabled: "1" }, select: { id: true }, orderBy: { id: "asc" } });
    let synced = 0, syncFailed = 0;
    // 🎴 **والجردُ الشاملُ للكروت معها** (بلاغ محمد 2026-08-21): كان `runFullCardAudit`
    // له مُستدعٍ واحدٌ في البرنامج كلِّه — «المزامنة اليدويّة». فكارتٌ استُهلك في الساس
    // خارجَ نافذةِ الأمس/اليوم لا يراه أحدٌ حتى يضغط محمد يدويّاً، ويبقى «متاحاً» في
    // المخزن فيُسحب مرّتَين. الآن يعمل كلَّ ليلةٍ تلقائيّاً بعد مزامنة كلّ مكتب — نافذتُه
    // ١٢٠ يوماً وكلُّ كروت الوكيل، وفشلُه لا يُسقط الكتلةَ (مكسبٌ لا شرط).
    const { runFullCardAudit } = await import("./subscriptionSync");
    let audited = 0, auditMarked = 0;
    for (const o of offices) {
      try { await runOfficeSyncAll(o.id, { notify: false }); synced++; }
      catch (e) { syncFailed++; console.error(`[internal-cron] مزامنةُ المكتب ${o.id} فشلت:`, e instanceof Error ? e.message : e); }
      try {
        const ca = await runFullCardAudit(o.id);
        if (!ca.error) { audited++; auditMarked += ca.markedUsed; }
        else console.error(`[internal-cron] جردُ كروت المكتب ${o.id}:`, ca.error);
      } catch (e) { console.error(`[internal-cron] جردُ كروت المكتب ${o.id} سقط:`, e instanceof Error ? e.message : e); }
    }
    if (audited) console.log(`[internal-cron] 🎴 جردُ الكروت الليليّ: ${audited} مكتباً · عُلّم مستخدماً ${auditMarked}`);
    await finalizeDay(c.rowId, todayKey);
    console.log(`[internal-cron] ✅ الكتلة الليليّة (${todayKey}): دعمٌ أُنهي ${r.supportEnded} · أرشيفٌ نُظّف ${purged} · تنبيهاتُ خطط ${warns.notified} · مزامنة ${synced}/${offices.length}${syncFailed ? ` (فشل ${syncFailed})` : ""}`);
  } catch (e) {
    console.error(`[internal-cron] 🔴 الكتلة الليليّة سقطت — تُعاد خلال ٥ دقائق:`, e instanceof Error ? e.message : e);
    await releaseDay(c.rowId, c.prev ?? null);
  }
}

// ═════ ٣ · نسخة المالك إلى درايف ═════
let cfgWarnDay = ""; // تحذير «غير مهيّأ» مرّةً يوميّاً لا كلَّ ٥ دقائق
async function driveBackup(dayKey: string): Promise<void> {
  const { driveConfigured, uploadBackupToDrive } = await import("./driveBackup");
  if (!driveConfigured()) {
    if (cfgWarnDay !== dayKey) { cfgWarnDay = dayKey; console.warn("[internal-cron] ☁️ درايف غير مهيّأ (GDRIVE_SA_B64/GDRIVE_FOLDER_ID) — نسخةُ المالك اليوميّة معلّقة"); }
    return;
  }
  const c = await claimDay("lastOwnerDriveDate", dayKey, DRIVE_TTL_MS);
  if (!c.claimed || c.rowId == null) return;
  try {
    const { exportFullSystemBackup } = await import("./backup");
    const { gz, filename, tableCount, rowCount } = await exportFullSystemBackup();
    const { rotatedOut } = await uploadBackupToDrive(gz, filename);
    await finalizeDay(c.rowId, dayKey);
    const mb = (gz.length / 1048576).toFixed(1);
    console.log(`[internal-cron] ☁️ نسخة المالك رُفعت إلى درايف: ${filename} (${mb}MB · ${tableCount} جدولاً · ${rowCount} صفّاً)${rotatedOut ? ` · دُوّر ${rotatedOut}` : ""}`);
    await notifyOwner("☁️ نسخة النظام في درايف", `رُفعت ${filename} (${mb}MB — ${rowCount.toLocaleString("en-US")} صفّاً) إلى مجلّد النسخ في Google Drive.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[internal-cron] 🔴 نسخة درايف فشلت — تُعاد خلال ٥ دقائق:`, msg);
    await releaseDay(c.rowId, c.prev ?? null);
    // إنذارٌ أحمرُ مرّةً واحدةً في اليوم — والمحاولاتُ تستمرّ كلَّ ٥ دقائق حتى تنجح
    const f = await claimDay("lastOwnerDriveFailDate", dayKey, 24 * 3600_000);
    if (f.claimed && f.rowId != null) {
      await finalizeDay(f.rowId, dayKey);
      await notifyOwner("🔴 فشلت نسخة درايف اليوم", `السبب: ${msg.slice(0, 160)} — تُعاد المحاولة كلّ ٥ دقائق تلقائيّاً.`);
    }
  }
}

let agentCfgWarnDay = "";
const lastAgentAttempt = new Map<number, number>();
async function agentBackups(now: Date, dayKey: string): Promise<void> {
  const { gmailConfigured, gmailReady } = await import("./gmailSend");
  if (!gmailConfigured()) {
    if (agentCfgWarnDay !== dayKey) { agentCfgWarnDay = dayKey; console.warn("[internal-cron] ✉️ Gmail غير مهيّأ (GMAIL_REFRESH_TOKEN) — نسخُ الوكلاء السحابيّة معلّقة"); }
    return;
  }
  const agents = await prisma.agent.findMany({
    where: { isDeleted: false, backupEmail: { not: null }, OR: [{ lastBackupDate: null }, { lastBackupDate: { not: dayKey } }] },
    select: { id: true },
  });
  if (!agents.length) return;
  const mins = baghdadMinutes(now);
  const { getAgentSetting } = await import("./agentSettings");
  const due: number[] = [];
  for (const a of agents) {
    const bt = await getAgentSetting("backupTime", a.id, "04:00");
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(bt);
    const dueMin = m ? Number(m[1]) * 60 + Number(m[2]) : 4 * 60;
    if (mins >= dueMin) due.push(a.id);
  }
  if (!due.length) return;
  if (!(await gmailReady())) {
    if (agentCfgWarnDay !== dayKey) { agentCfgWarnDay = dayKey; console.warn("[internal-cron] ✉️ توكِن Gmail مرفوضٌ — نسخُ الوكلاء معلّقةٌ (لا تصدير)"); }
    return;
  }
  const { runDailyBackups } = await import("./backupJob");
  let sent = 0, failed = 0;
  for (const id of due) {
    const la = lastAgentAttempt.get(id);
    if (la && Date.now() - la < 60 * 60_000) continue;
    lastAgentAttempt.set(id, Date.now());
    const r = await runDailyBackups(id).catch((e) => { console.error(`[internal-cron] نسخة الوكيل ${id}:`, e instanceof Error ? e.message : e); return { total: 0, sent: 0, failed: 1 }; });
    sent += r.sent; failed += r.failed;
  }
  if (sent) console.log(`[internal-cron] ✉️ نسخُ الوكلاء السحابيّة: أُرسلت ${sent}${failed ? ` · فشل ${failed}` : ""}`);
  if (failed) {
    const f = await claimDay("lastAgentBackupFailDate", dayKey, 24 * 3600_000);
    if (f.claimed && f.rowId != null) {
      await finalizeDay(f.rowId, dayKey);
      await notifyOwner("🔴 نسخُ وكلاءَ لم تُرسَل", `${failed} نسخةَ وكيلٍ فشلت اليوم (قد يتجاوزُ الحجمُ حدَّ المرفق). تُعادُ المحاولةُ تلقائيّاً كلَّ ٥ دقائق.`);
    }
  }
}

const ultraReminderAt = new Map<number, number>();
async function ultraMsgOfficeSends(now: Date): Promise<void> {
  const { listUltraMsgOffices } = await import("./waChannel");
  const ids = await listUltraMsgOffices();
  if (!ids.length) return;
  const offs = await prisma.tower.findMany({
    where: { id: { in: ids }, isDeleted: false },
    select: {
      id: true, agentId: true, reminderTime: true, silent: true, waEnabled: true, lastReminderDate: true,
      debtReminderEnabled: true, debtReminderTime: true, lastDebtReminderDate: true,
      expiredNoticeEnabled: true, expiredNoticeTime: true, lastExpiredNoticeDate: true,
    },
  });
  if (!offs.length) return;
  const nowHM = baghdadHM(now);
  const todayK = baghdadDayKey(now);
  const { getAgentSetting } = await import("./agentSettings");
  const agentCache = new Map<number | null, string>();
  const agentReminder = async (agentId: number | null): Promise<string> => {
    const hit = agentCache.get(agentId);
    if (hit !== undefined) return hit;
    const t = await getAgentSetting("reminderTime", agentId, "13:00");
    agentCache.set(agentId, t);
    return t;
  };
  const expiring: number[] = [], debt: number[] = [], expired: number[] = [];
  for (const o of offs) {
    try {
      if (o.waEnabled === "0") continue;
      const la = ultraReminderAt.get(o.id);
      if (la != null && Date.now() - la < 20 * 60_000) continue;
      const base = o.reminderTime?.trim() || (await agentReminder(o.agentId));
      let due = false;
      if (o.silent !== "0" && nowHM >= base && o.lastReminderDate !== todayK) { expiring.push(o.id); due = true; }
      if (o.debtReminderEnabled === "1") {
        const t = o.debtReminderTime?.trim() || base;
        if (nowHM >= t && o.lastDebtReminderDate !== todayK) { debt.push(o.id); due = true; }
      }
      if (o.expiredNoticeEnabled === "1") {
        const t = o.expiredNoticeTime?.trim() || base;
        if (nowHM >= t && o.lastExpiredNoticeDate !== todayK) { expired.push(o.id); due = true; }
      }
      if (due) ultraReminderAt.set(o.id, Date.now());
    } catch (e) {
      console.error(`[internal-cron] ↗️ تصنيف مكتب ${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
  const sched = await import("./scheduler");
  if (expiring.length) await sched.runExpiringReminder(expiring, { claimDay: true }).catch((e) => console.error("[internal-cron] ↗️ تذكير الانتهاء (UltraMsg):", e instanceof Error ? e.message : e));
  if (debt.length) await sched.runDebtReminder(debt, { claimDay: true }).catch((e) => console.error("[internal-cron] ↗️ الديون (UltraMsg):", e instanceof Error ? e.message : e));
  if (expired.length) await sched.runExpiredNotice(expired, { claimDay: true }).catch((e) => console.error("[internal-cron] ↗️ المنتهون (UltraMsg):", e instanceof Error ? e.message : e));
  const selfMod = await import("./selfActivatedNotice");
  const syncMod = await import("./syncAutoMsg");
  for (const o of offs) {
    await selfMod.drainSelfActivatedQueue(o.id).catch(() => {});
    await syncMod.drainSyncMsgQueue(o.id).catch(() => {});
  }
}

// ═════ الدورة — تُركَل كلَّ ٥ دقائق من instrumentation.ts (الموقعُ حصراً) ═════
const g = globalThis as unknown as { __internalCron?: boolean; __ultraSending?: boolean };
export function kickInternalCron(reason: string): void {
  if (g.__internalCron) return; // دورةٌ سابقة ما زالت تعمل (مزامنةٌ طويلة؟) — لا تراكب
  g.__internalCron = true;
  void tick(reason)
    .catch((e) => console.error("[internal-cron] الدورةُ سقطت:", e instanceof Error ? e.message : e))
    .finally(() => { g.__internalCron = false; });
}

async function tick(reason: string): Promise<void> {
  const now = new Date();
  const todayKey = baghdadDayKey(now);
  const mins = baghdadMinutes(now);
  if (reason === "إقلاع الموقع") console.log("[internal-cron] ⏰ الكرون الداخليّ انطلق");

  // ١ · بصمة الخروج بوقتِ كلِّ فنيّ — كلَّ دورة (رخيصة: تفحص المفتوحين المستحقّين فقط)
  const { runAutoCheckout } = await import("./autoCheckout");
  const r = await runAutoCheckout().catch((e) => { console.error("[internal-cron] بصمة الخروج:", e instanceof Error ? e.message : e); return { closed: 0, supportEnded: 0 }; });
  if (r.closed > 0) console.log(`[internal-cron] ⏱️ أُغلقت ${r.closed} بصمة خروجٍ تلقائيّاً`);

  // ٢ · الكتلة الليليّة بعد 00:15
  if (mins >= NIGHTLY_AT_MIN) await nightlyBlock(todayKey);

  // ٣ · نسخة درايف في وقتها المضبوط (حساب المالك ← «وقت الإرسال»، الافتراضيّ 23:55)
  const at = await getSetting("ownerBackupTime");
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(at ?? "");
  const dueMin = m ? Number(m[1]) * 60 + Number(m[2]) : 23 * 60 + 55;
  if (mins >= dueMin) await driveBackup(todayKey);
  else {
    // 🛡️ تداركُ يومٍ فات: نافذةُ 23:55←منتصف الليل ضيّقة — لو صادف نشرٌ/سقوطٌ تلك الدقائق
    // تُرفَع نسخةُ الأمس الفائتة صباحاً بدل أن تضيع ليلةٌ بصمت. النداءُ آمنُ التكرار:
    // `claimDay` يرفضه فوراً إن كان الأمسُ مختوماً أو عُهدتُه طازجة.
    await driveBackup(baghdadDayKey(new Date(now.getTime() - 24 * 3600 * 1000)));
  }

  await agentBackups(now, todayKey);
  if (!g.__ultraSending) {
    g.__ultraSending = true;
    void ultraMsgOfficeSends(now)
      .catch((e) => console.error("[internal-cron] ↗️ إرسال UltraMsg سقط:", e instanceof Error ? e.message : e))
      .finally(() => { g.__ultraSending = false; });
  }
}
