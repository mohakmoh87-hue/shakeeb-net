import { prisma } from "@/lib/prisma";
import { exportAgentBackup, exportFullSystemBackup } from "@/lib/backup";
import { sendMail, mailerConfigured } from "@/lib/mailer";
import { baghdadDayKey } from "@/lib/attendance";

// إرسال نسخة احتياطية لوكيل واحد إلى إيميله المضبوط
export async function sendAgentBackupEmail(agentId: number): Promise<{ ok: boolean; error?: string }> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, backupEmail: true } });
  if (!agent?.backupEmail) return { ok: false, error: "لا يوجد إيميل نسخ احتياطي مضبوط" };
  const { gz, filename } = await exportAgentBackup(agentId);
  const today = new Date().toISOString().slice(0, 10);
  return sendMail({
    to: agent.backupEmail,
    subject: `نسخة احتياطية — ${agent.name ?? "SHAKEEB"} — ${today}`,
    text:
      `مرفق نسخة احتياطية كاملة لبيانات «${agent.name ?? ""}» بتاريخ ${today}.\n\n` +
      `احتفظ بهذا الملف. لاسترجاع بياناتك في أي وقت: افتح البرنامج ← الإعدادات ← النسخ الاحتياطي ← «استرجاع عن طريق النسخة الاحتياطية» وارفع هذا الملف.`,
    attachments: [{ filename, content: gz, contentType: "application/gzip" }],
  });
}

// المهمة اليومية: إرسال نسخة كل وكيل لديه إيميل نسخ مضبوط إلى إيميله.
// تعمل من الكرون السحابي (حتى لو كانت الحاسبات مغلقة) ومن مجدول الحاسبة —
// بعلامة lastBackupDate (يوم بغداد) تمنع إرسال نسختين لنفس اليوم.
// agentId اختياري: يُمرَّر من المجدول (قائد كل وكيل ينفّذ لوكيله فقط).
export async function runDailyBackups(agentId?: number | null): Promise<{ total: number; sent: number; failed: number }> {
  if (!mailerConfigured()) {
    console.warn("[backup] لم تُضبط بيانات SMTP — تخطّي النسخ اليومي بالبريد");
    return { total: 0, sent: 0, failed: 0 };
  }
  const todayKey = baghdadDayKey(new Date());
  const agents = await prisma.agent.findMany({
    // لم تُرسَل نسخة اليوم بعد (من السحابة أو الحاسبة) — منع الازدواج
    where: {
      isDeleted: false, backupEmail: { not: null },
      OR: [{ lastBackupDate: null }, { lastBackupDate: { not: todayKey } }],
      ...(agentId != null ? { id: agentId } : {}),
    },
    select: { id: true, lastBackupDate: true },
  });
  let sent = 0, failed = 0;
  for (const a of agents) {
    // ═════ ب-١/الأصل ٢ · ختمُ اليوم **قبل** العمل لا بعده (2026-08-13) ═════
    // 🔴 كان الختمُ (`lastBackupDate`) يُكتَب **بعد** نجاح الإرسال، والإرسالُ يُصدّر القاعدةَ
    //   كلَّها ويُرفقها بالبريد — دقائق. فطولَ تلك الدقائق يبقى الشرطُ أعلاه يقول «لم تُرسَل
    //   نسخةُ اليوم»، فحاسبةٌ أخرى (أو دورةُ المُجدول التالية) تبدأ نسخةً ثانيةً كاملة:
    //   **قاعدةٌ كاملةٌ تُصدَّر وتُرسَل مرّتَين** — وهي مرشَّحُ إنفادِ اتصالات القاعدة.
    // ⇒ يُحجَز اليومُ ذرّيّاً بـ`updateMany` بشرطِ أنّه لم يُختَم: فائزٌ واحدٌ أبداً.
    // ⚠️ SQL صريحٌ لا `prisma.agent.updateMany`: جدولُ `agents` فيه ٢٦ عموداً ودورُ العامل
    // يقرأ ١٥، وبريزما (محرّكُ العميل) تقرأ الصفَّ كاملاً عند `updateMany` ⇒ `SELECT *` ⇒
    // «permission denied for table agents». وقد كلّفت هذه العلّةُ نفسُها موتَ القيادة
    // ساعةً وربعاً في 2026-08-13 — فالنمطُ واحدٌ في كلّ كتابةٍ على `agents` من العامل.
    const claimed = await prisma.$executeRaw`
      UPDATE agents SET "lastBackupDate" = ${todayKey}
       WHERE id = ${a.id} AND ("lastBackupDate" IS NULL OR "lastBackupDate" <> ${todayKey})`;
    if (claimed !== 1) continue; // سبقنا غيرُنا إلى نسخة اليوم
    try {
      const r = await sendAgentBackupEmail(a.id);
      if (r.ok) sent++;
      else {
        failed++; console.warn(`[backup] فشل إرسال نسخة الوكيل ${a.id}: ${r.error}`);
        // يُفَكّ الحجزُ فتُعاد المحاولةُ في الدورة القادمة — فيومٌ بلا نسخةٍ أخطرُ من نسخةٍ
        // مكرّرةٍ تصل بريدَ محمد. والفشلُ هنا يعني أنّ خادمَ البريد **لم يقبل** الرسالة.
        await prisma.$executeRaw`UPDATE agents SET "lastBackupDate" = ${a.lastBackupDate} WHERE id = ${a.id}`.then(() => {}, () => {});
      }
    } catch (e) {
      failed++; console.error(`[backup] خطأ نسخة الوكيل ${a.id}:`, e);
      await prisma.$executeRaw`UPDATE agents SET "lastBackupDate" = ${a.lastBackupDate} WHERE id = ${a.id}`.then(() => {}, () => {});
    }
  }
  console.log(`[backup] النسخ اليومي: ${sent} ناجحة، ${failed} فاشلة من ${agents.length}`);
  return { total: agents.length, sent, failed };
}

// نسخة النظام الكاملة (ملف واحد يضمّ كل الوكلاء وحساباتهم وكروتهم وكل تفصيل) إلى إيميل المالك.
// عند الاستعادة يعود النظام بأكمله تماماً كما وقت النسخ — «لا يضيع شيء لأي أحد».
// الإيميل يُضبط من: حساب المالك ← «إيميل النسخة الكاملة» (system_settings type=ownerBackupEmail).
// دمج مانع للازدواج بعلامة lastOwnerBackupDate (يوم بغداد). skipDedup للإرسال الفوري/الاختبار.
export async function sendOwnerFullBackup(opts?: { skipDedup?: boolean }): Promise<{ ok: boolean; tables?: number; rows?: number; error?: string }> {
  if (!mailerConfigured()) return { ok: false, error: "SMTP غير مضبوط" };
  const emailRow = await prisma.systemSetting.findFirst({ where: { type: "ownerBackupEmail" } });
  const to = emailRow?.value?.trim();
  if (!to) return { ok: false, error: "لا يوجد إيميل نسخة المالك" };

  const todayKey = baghdadDayKey(new Date());
  // ═════ ب-١/الأصل ٢ · حَجزُ يومِ نسخةِ المالك **قبل** تصديرها (2026-08-13) ═════
  // 🔴 كان فحصاً ثمّ عملاً ثمّ ختماً: يقرأ العلامةَ، ثمّ **يُصدّر النظامَ كلَّه ويُرسله**
  //   (دقائق)، ثمّ يختم. فحاسبتان — أو دورتا مُجدولٍ — تريان العلامةَ قديمةً معاً
  //   فتُصدّران **النظامَ كلَّه مرّتَين**: ضغطٌ على القاعدة وبريدٌ مكرَّر.
  // ⇒ الحجزُ ذرّيٌّ بمقارنةٍ-وتبديل: نكتب علامةَ اليوم بشرطِ أنّها ليست علامةَ اليوم
  //   أصلاً، فمَن كتب أوّلاً يفوز والباقي يعود بلا عمل. و`skipDedup` (الإرسالُ الفوريُّ
  //   بيد المالك) يتخطّى الحجزَ كما كان يتخطّى الفحص — فهو طلبٌ صريحٌ لا جدولةٌ.
  // ⏳ والحجزُ **بعُهدةٍ زمنيّة** لا ختمٌ أعمى (سدُّ ثغرة 2026-08-20): إعادةُ نشرٍ وقعت
  // وسطَ التصدير فقُتلت الحاويةُ قتلاً صامتاً (SIGKILL) لا يمرّ بمسار الفشل — فبقي اليومُ
  // مختوماً وما أُرسل شيء، وصمتت بقيّةُ الدورات. الآن يُكتَب الحجزُ `اليوم#pending#وقت`
  // ولا يصير `اليوم` الصريحَ إلّا **بعد** نجاح الإرسال؛ فحجزٌ معلّقٌ جاوز ٣٠ دقيقةً
  // جثّةٌ تُنتزَع منها العهدةُ وتُعاد المحاولة.
  let claimedRow: { id: number; prev: string | null } | null = null;
  if (!opts?.skipDedup) {
    const c = await claimOwnerBackupDay(todayKey);
    if (!c.claimed) return { ok: true, error: c.reason };
    claimedRow = c.row;
  }

  // ═════ 🔴 «باكاب كامل النظام لا يصل ويفشل» (بلاغُ محمد 2026-08-20) ═════
  // منذ 16 آب فشلت **كلُّ** المحاولات، والعلامةُ بقيت على 2026-08-15 — أي أنّ التصديرَ
  // كان يكتمل و`sendMail` هو الذي يرفض، والخطأُ لا يسجَّل في أيّ مكان. والجاني حجمُ
  // المرفق: القاعدةُ ١٠١MB وملفُّها المضغوط تخطّى حدَّ Gmail (٢٥MB **بعد** ترميز base64
  // الذي يضخّم ١٫٣٧× ⇒ الحدُّ الفعليّ ~١٨MB gz). فالعلاج ثلاثيّ:
  //   ١) التقسيم: أجزاءٌ ≤ ١٥MB لكلٍّ بريدُه — تُجمَع عند الحاجة بأمرٍ واحدٍ مرفقٍ في النصّ.
  //   ٢) الصراخ: فشلُ الإرسال يُسجَّل ويُرسَل عنه **بريدُ إنذارٍ صغير** (مرّةً في اليوم) —
  //      فبريدُ محمد هو الشاشةُ الوحيدة التي يراقبها فعلاً.
  //   ٣) فكُّ الحجز في finally لا بعد `sendMail` وحدَه — كان الانفجارُ في التصدير يُبقي
  //      اليومَ محجوزاً فتصمت بقيّةُ الدورات وكأنّ النسخةَ أُرسلت.
  const PART_MAX = 15 * 1024 * 1024;
  try {
    const { gz, filename, tableCount, rowCount } = await exportFullSystemBackup();
    const today = new Date().toISOString().slice(0, 10);
    const sizeMb = (gz.length / 1048576).toFixed(1);
    const parts = Math.max(1, Math.ceil(gz.length / PART_MAX));
    const keepNote =
      `احتفظ بهذا الملف جيّداً. لاستعادة كل شيء على نظام/دومين جديد: راجع docs/RECOVERY.md في حقيبة النجاة، ` +
      `أو من حساب المالك ← «استعادة نسخة كاملة» وارفع هذا الملف (يستبدل كل البيانات الحالية).`;
    if (parts === 1) {
      const r = await sendMail({
        to,
        subject: `نسخة النظام الكاملة — كل الوكلاء — ${today}`,
        text:
          `مرفق ملف نسخة كاملة للنظام بأكمله بتاريخ ${today} (${tableCount} جدولاً، ${rowCount} صفّاً، ${sizeMb}MB).\n` +
          `يضمّ كل الوكلاء وحساباتهم وكروتهم وكل تفاصيلهم.\n\n${keepNote}`,
        attachments: [{ filename, content: gz, contentType: "application/gzip" }],
      });
      if (!r.ok) throw new Error(r.error ?? "خادم البريد رفض الرسالة");
    } else {
      // أسماءُ الأجزاء وأمرُ جمعها يُبنيان مرّةً ويُرفَقان في **كلّ** جزء — فلو وصل جزءٌ
      // وضاع بريدُ غيرِه بقيت التعليماتُ كاملةً بين يدَي محمد.
      const partNames = Array.from({ length: parts }, (_, i) => `${filename}.part${i + 1}of${parts}`);
      const joinCmd = `copy /b ${partNames.map((n) => `"${n}"`).join("+")} "${filename}"`;
      for (let i = 0; i < parts; i++) {
        const r = await sendMail({
          to,
          subject: `نسخة النظام الكاملة — الجزء ${i + 1} من ${parts} — ${today}`,
          text:
            `النسخة الكاملة بتاريخ ${today} (${tableCount} جدولاً، ${rowCount} صفّاً، ${sizeMb}MB) أكبر من حدّ المرفق الواحد، ` +
            `فقُسّمت ${parts} أجزاء — هذا الجزء ${i + 1}.\n\n` +
            `للاستعادة: نزّل الأجزاء كلّها في مجلد واحد ثم اجمعها ملفاً واحداً بأمرٍ واحد في CMD:\n${joinCmd}\n` +
            `ثم ارفع «${filename}» الناتج في «استعادة نسخة كاملة».\n\n${keepNote}`,
          attachments: [{ filename: partNames[i], content: gz.subarray(i * PART_MAX, (i + 1) * PART_MAX), contentType: "application/octet-stream" }],
        });
        if (!r.ok) throw new Error(`فشل إرسال الجزء ${i + 1}/${parts}: ${r.error ?? "خادم البريد رفض الرسالة"}`);
      }
    }
    // نجح الإرسال ⇒ تُستبدَل العهدةُ المعلّقة بختم اليوم الصريح (هو وحدَه يعني «وصلت»)
    if (claimedRow) {
      await prisma.systemSetting.update({ where: { id: claimedRow.id }, data: { value: todayKey } }).catch(() => {});
    }
    console.log(`[backup] ✅ نسخة المالك الكاملة أُرسلت (${tableCount} جدولاً، ${rowCount} صفّاً، ${sizeMb}MB في ${parts} ${parts === 1 ? "رسالة" : "أجزاء"})`);
    return { ok: true, tables: tableCount, rows: rowCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[backup] 🔴 فشلت نسخة المالك الكاملة: ${msg}`);
    // فكُّ الحجز فتُعاد المحاولةُ في الدورة القادمة: يومٌ بلا نسخةٍ أخطرُ من بريدٍ مكرَّر
    if (claimedRow) {
      await prisma.systemSetting.update({ where: { id: claimedRow.id }, data: { value: claimedRow.prev } }).catch(() => {});
    }
    await notifyOwnerBackupFailure(to, msg, todayKey);
    return { ok: false, error: msg };
  }
}

// ═════ حَجزُ يومِ نسخةِ المالك — بعُهدةٍ زمنيّةٍ تَبلى (يشترك فيه مسارُ التنزيل ومسارُ البريد) ═════
const PENDING_TTL_MS = 30 * 60 * 1000;

export type OwnerBackupClaim =
  | { claimed: true; row: { id: number; prev: string | null } }
  | { claimed: false; reason: string };

// يدّعي نسخةَ اليوم ذرّيّاً: `اليوم#pending#وقت` — والعهدةُ الباليةُ (صاحبُها قُتل) تُنتزَع.
export async function claimOwnerBackupDay(todayKey: string): Promise<OwnerBackupClaim> {
  const last = await prisma.systemSetting.findFirst({
    where: { type: "lastOwnerBackupDate" }, select: { id: true, value: true }, orderBy: { id: "asc" },
  });
  if (last?.value === todayKey) return { claimed: false, reason: "أُرسلت اليوم مسبقاً" };
  if (last?.value?.startsWith(`${todayKey}#pending#`)) {
    const startedAt = Number(last.value.split("#")[2]);
    if (Number.isFinite(startedAt) && Date.now() - startedAt < PENDING_TTL_MS) {
      return { claimed: false, reason: "محاولةٌ جاريةٌ الآن" };
    }
    // عهدةٌ بالية — تُنتزَع أدناه بالمقارنة-والتبديل نفسِها
  }
  if (last) {
    const won = await prisma.systemSetting.updateMany({
      where: { id: last.id, value: last.value }, data: { value: `${todayKey}#pending#${Date.now()}` },
    });
    if (won.count !== 1) return { claimed: false, reason: "سبقنا غيرُنا إلى نسخة اليوم" };
    return { claimed: true, row: { id: last.id, prev: last.value } };
  }
  const made = await prisma.systemSetting.create({
    data: { type: "lastOwnerBackupDate", value: `${todayKey}#pending#${Date.now()}` }, select: { id: true },
  });
  // لا فهرسَ فريداً على `type` ⇒ الحسمُ بأصغرِ مُعرِّف، والخاسرُ يحذف صفَّه
  const all = await prisma.systemSetting.findMany({
    where: { type: "lastOwnerBackupDate" }, select: { id: true }, orderBy: { id: "asc" },
  });
  if (all[0]?.id !== made.id) {
    await prisma.systemSetting.delete({ where: { id: made.id } }).catch(() => {});
    return { claimed: false, reason: "أُرسلت اليوم مسبقاً" };
  }
  return { claimed: true, row: { id: made.id, prev: null } };
}

// نجاحُ الإرسال (يصل من طلبٍ منفصلٍ — مهمّةُ GitHub تؤكّد بعد قبول البريد):
// تُستبدَل العهدةُ المعلّقةُ بختم اليوم الصريح. يعيد false إن لم تكن عهدةُ اليوم قائمة.
export async function finalizeOwnerBackupDay(todayKey: string): Promise<boolean> {
  const last = await prisma.systemSetting.findFirst({
    where: { type: "lastOwnerBackupDate" }, select: { id: true, value: true }, orderBy: { id: "asc" },
  });
  if (!last?.value?.startsWith(`${todayKey}#pending#`)) return last?.value === todayKey;
  const won = await prisma.systemSetting.updateMany({
    where: { id: last.id, value: last.value }, data: { value: todayKey },
  });
  return won.count === 1;
}

// بريدُ إنذارٍ صغيرٌ (بلا مرفق) عند فشل النسخة الكاملة — **مرّةً واحدةً في اليوم** كي لا
// تتحوّل إعاداتُ المحاولة الساعيّةُ ٢٤ رسالةَ إزعاج. حَجزُ اليوم بنمط المقارنة-والتبديل نفسِه.
async function notifyOwnerBackupFailure(to: string, reason: string, todayKey: string): Promise<void> {
  try {
    const last = await prisma.systemSetting.findFirst({
      where: { type: "lastOwnerBackupFailDate" }, select: { id: true, value: true }, orderBy: { id: "asc" },
    });
    if (last?.value === todayKey) return;
    if (last) {
      const won = await prisma.systemSetting.updateMany({ where: { id: last.id, value: last.value }, data: { value: todayKey } });
      if (won.count !== 1) return;
    } else {
      await prisma.systemSetting.create({ data: { type: "lastOwnerBackupFailDate", value: todayKey } });
    }
    await sendMail({
      to,
      subject: `⚠️ فشلت نسخة النظام الكاملة اليوم — ${todayKey}`,
      text:
        `تعذّر إرسال نسخة النظام الكاملة.\nالسبب: ${reason}\n\n` +
        `ستُعاد المحاولة تلقائياً كل ساعة، وإن نجحت لاحقاً وصلتك النسخة كالمعتاد. ` +
        `إن تكرّر هذا الإنذار أياماً متتالية فأخبر الدعم.`,
    });
  } catch (e) {
    console.error("[backup] تعذّر حتى إرسال إنذار الفشل:", e instanceof Error ? e.message : e);
  }
}
