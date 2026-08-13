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
    const claimed = await prisma.agent.updateMany({
      where: { id: a.id, OR: [{ lastBackupDate: null }, { lastBackupDate: { not: todayKey } }] },
      data: { lastBackupDate: todayKey },
    });
    if (claimed.count !== 1) continue; // سبقنا غيرُنا إلى نسخة اليوم
    try {
      const r = await sendAgentBackupEmail(a.id);
      if (r.ok) sent++;
      else {
        failed++; console.warn(`[backup] فشل إرسال نسخة الوكيل ${a.id}: ${r.error}`);
        // يُفَكّ الحجزُ فتُعاد المحاولةُ في الدورة القادمة — فيومٌ بلا نسخةٍ أخطرُ من نسخةٍ
        // مكرّرةٍ تصل بريدَ محمد. والفشلُ هنا يعني أنّ خادمَ البريد **لم يقبل** الرسالة.
        await prisma.agent.update({ where: { id: a.id }, data: { lastBackupDate: a.lastBackupDate } }).catch(() => {});
      }
    } catch (e) {
      failed++; console.error(`[backup] خطأ نسخة الوكيل ${a.id}:`, e);
      await prisma.agent.update({ where: { id: a.id }, data: { lastBackupDate: a.lastBackupDate } }).catch(() => {});
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
  let claimedRow: { id: number; prev: string | null } | null = null;
  if (!opts?.skipDedup) {
    const last = await prisma.systemSetting.findFirst({
      where: { type: "lastOwnerBackupDate" }, select: { id: true, value: true }, orderBy: { id: "asc" },
    });
    if (last?.value === todayKey) return { ok: true, error: "أُرسلت اليوم مسبقاً" };
    if (last) {
      const won = await prisma.systemSetting.updateMany({
        where: { id: last.id, value: last.value }, data: { value: todayKey },
      });
      if (won.count !== 1) return { ok: true, error: "أُرسلت اليوم مسبقاً" };
      claimedRow = { id: last.id, prev: last.value };
    } else {
      const made = await prisma.systemSetting.create({
        data: { type: "lastOwnerBackupDate", value: todayKey }, select: { id: true },
      });
      // لا فهرسَ فريداً على `type` ⇒ الحسمُ بأصغرِ مُعرِّف، والخاسرُ يحذف صفَّه
      const all = await prisma.systemSetting.findMany({
        where: { type: "lastOwnerBackupDate" }, select: { id: true }, orderBy: { id: "asc" },
      });
      if (all[0]?.id !== made.id) {
        await prisma.systemSetting.delete({ where: { id: made.id } }).catch(() => {});
        return { ok: true, error: "أُرسلت اليوم مسبقاً" };
      }
      claimedRow = { id: made.id, prev: null };
    }
  }

  const { gz, filename, tableCount, rowCount } = await exportFullSystemBackup();
  const today = new Date().toISOString().slice(0, 10);
  const r = await sendMail({
    to,
    subject: `نسخة النظام الكاملة — كل الوكلاء — ${today}`,
    text:
      `مرفق ملف نسخة كاملة للنظام بأكمله بتاريخ ${today} (${tableCount} جدولاً، ${rowCount} صفّاً).\n` +
      `يضمّ كل الوكلاء وحساباتهم وكروتهم وكل تفاصيلهم.\n\n` +
      `احتفظ بهذا الملف جيّداً. لاستعادة كل شيء على نظام/دومين جديد: راجع docs/RECOVERY.md في حقيبة النجاة، ` +
      `أو من حساب المالك ← «استعادة نسخة كاملة» وارفع هذا الملف (يستبدل كل البيانات الحالية).`,
    attachments: [{ filename, content: gz, contentType: "application/gzip" }],
  });

  // العلامةُ خُتمت سلفاً في الحجز (أعلاه) — فلا شيءَ يُكتَب هنا عند النجاح. وعند الفشل
  // يُفَكّ الحجزُ فتُعاد المحاولةُ في الدورة القادمة: يومٌ بلا نسخةٍ أخطرُ من بريدٍ مكرَّر،
  // وفشلُ `sendMail` يعني أنّ خادمَ البريد **لم يقبل** الرسالة.
  if (!r.ok && claimedRow) {
    await prisma.systemSetting.update({ where: { id: claimedRow.id }, data: { value: claimedRow.prev } }).catch(() => {});
  }
  return { ok: r.ok, tables: tableCount, rows: rowCount, error: r.error };
}
