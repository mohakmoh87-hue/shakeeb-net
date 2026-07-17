import { prisma } from "@/lib/prisma";
import { exportAgentBackup } from "@/lib/backup";
import { sendMail, mailerConfigured } from "@/lib/mailer";

// إرسال نسخة احتياطية لوكيل واحد إلى إيميله المضبوط
export async function sendAgentBackupEmail(agentId: number): Promise<{ ok: boolean; error?: string }> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, backupEmail: true } });
  if (!agent?.backupEmail) return { ok: false, error: "لا يوجد إيميل نسخ احتياطي مضبوط" };
  const { gz, filename } = await exportAgentBackup(agentId);
  const today = new Date().toISOString().slice(0, 10);
  return sendMail({
    to: agent.backupEmail,
    subject: `نسخة احتياطية — ${agent.name ?? "شكيب نت"} — ${today}`,
    text:
      `مرفق نسخة احتياطية كاملة لبيانات «${agent.name ?? ""}» بتاريخ ${today}.\n\n` +
      `احتفظ بهذا الملف. لاسترجاع بياناتك في أي وقت: افتح البرنامج ← الإعدادات ← النسخ الاحتياطي ← «استرجاع عن طريق النسخة الاحتياطية» وارفع هذا الملف.`,
    attachments: [{ filename, content: gz, contentType: "application/gzip" }],
  });
}

// المهمة اليومية: إرسال نسخة كل وكيل لديه إيميل نسخ مضبوط إلى إيميله.
// agentId اختياري: يُمرَّر من المجدول (قائد كل وكيل ينفّذ لوكيله فقط) لتفادي التكرار
// عند تعدّد قادة الوكلاء. بلا agentId يشمل كل الوكلاء (للاستخدام اليدوي).
export async function runDailyBackups(agentId?: number | null): Promise<{ total: number; sent: number; failed: number }> {
  if (!mailerConfigured()) {
    console.warn("[backup] لم تُضبط بيانات SMTP — تخطّي النسخ اليومي بالبريد");
    return { total: 0, sent: 0, failed: 0 };
  }
  const agents = await prisma.agent.findMany({
    where: { isDeleted: false, backupEmail: { not: null }, ...(agentId != null ? { id: agentId } : {}) },
    select: { id: true },
  });
  let sent = 0, failed = 0;
  for (const a of agents) {
    try {
      const r = await sendAgentBackupEmail(a.id);
      if (r.ok) sent++; else { failed++; console.warn(`[backup] فشل إرسال نسخة الوكيل ${a.id}: ${r.error}`); }
    } catch (e) { failed++; console.error(`[backup] خطأ نسخة الوكيل ${a.id}:`, e); }
  }
  console.log(`[backup] النسخ اليومي: ${sent} ناجحة، ${failed} فاشلة من ${agents.length}`);
  return { total: agents.length, sent, failed };
}
