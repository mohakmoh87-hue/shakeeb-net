import { prisma } from "@/lib/prisma";
import { planState, type PlanState } from "@/lib/agentPlan";
import { notify } from "@/lib/notify";
import { sendMail, mailerConfigured } from "@/lib/mailer";

// تنبيهات انتهاء اشتراك الوكلاء — تعمل من الكرون الليلي.
// المراحل: قبل 7 أيام ← 3 أيام ← يوم واحد ← بدء مهلة السماح ← الإيقاف.
// يُرسَل تنبيه واحد لكل مرحلة (بلا تكرار) عبر علامة planWarn:{agentId} في system_settings.
// الوجهات: إشعار داخل البرنامج للوكيل + بريده (backupEmail) + تقرير مجمَّع لبريد المالك.

type Milestone = "d7" | "d3" | "d1" | "grace" | "blocked";

function milestoneOf(st: PlanState): Milestone | null {
  if (st.status === "warn") return st.daysLeft <= 1 ? "d1" : st.daysLeft <= 3 ? "d3" : "d7";
  if (st.status === "grace") return "grace";
  if (st.status === "blocked") return "blocked";
  return null; // عادي أو دائم — لا تنبيه
}

async function getMark(agentId: number): Promise<string | null> {
  const row = await prisma.systemSetting.findFirst({ where: { type: `planWarn:${agentId}` } });
  return row?.value ?? null;
}

async function setMark(agentId: number, value: string) {
  const type = `planWarn:${agentId}`;
  const existing = await prisma.systemSetting.findFirst({ where: { type } });
  if (existing) await prisma.systemSetting.update({ where: { id: existing.id }, data: { value } });
  else await prisma.systemSetting.create({ data: { type, value } });
}

export async function runPlanWarnings(): Promise<{ checked: number; notified: number }> {
  const agents = await prisma.agent.findMany({
    where: { isDeleted: false, approved: true, planExpiry: { not: null } },
    select: { id: true, name: true, planExpiry: true, backupEmail: true, isTrial: true },
  });

  const ownerLines: string[] = [];
  let notified = 0;

  for (const a of agents) {
    const st = planState(a.planExpiry);
    const ms = milestoneOf(st);
    if (!ms) continue;
    if ((await getMark(a.id)) === ms) continue; // أُرسل لهذه المرحلة مسبقاً

    const kind = a.isTrial ? "التجريبية" : "الاشتراك";
    const title = ms === "blocked" ? "⛔ أُوقف الحساب" : ms === "grace" ? "⛔ انتهى الاشتراك — مهلة سماح" : `⚠️ اقتراب انتهاء ${kind}`;
    const body = st.message ?? "";

    // إشعار داخل البرنامج (يصل مدير الوكيل + Push)
    await notify({ agentId: a.id, towerId: null, type: "plan-expiry", title, body, url: "/dashboard" }).catch(() => {});

    // بريد الوكيل (إن كان مضبوطاً)
    if (a.backupEmail && mailerConfigured()) {
      await sendMail({
        to: a.backupEmail,
        subject: `${title} — ${a.name ?? "SHAKEEB"}`,
        text: `${body}\n\nللتجديد تواصل مع إدارة SHAKEEB.`,
      }).catch(() => {});
    }

    ownerLines.push(`• ${a.name ?? `وكيل ${a.id}`}${a.isTrial ? " (تجريبي)" : ""}: ${body}`);
    await setMark(a.id, ms);
    notified++;
  }

  // تقرير مجمَّع للمالك
  if (ownerLines.length > 0 && mailerConfigured()) {
    const row = await prisma.systemSetting.findFirst({ where: { type: "ownerBackupEmail" } });
    const to = row?.value?.trim();
    if (to) {
      await sendMail({
        to,
        subject: `تنبيه اشتراكات الوكلاء (${ownerLines.length})`,
        text: `حالة اشتراكات تحتاج انتباهك:\n\n${ownerLines.join("\n")}\n\nللتجديد: لوحة المالك ← الوكلاء ← تمديد.`,
      }).catch(() => {});
    }
  }

  return { checked: agents.length, notified };
}
