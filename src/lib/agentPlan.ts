// حالة اشتراك **الوكيل** (المستأجر) — مصدر واحد للحقيقة تستعمله بوّابة الدخول والواجهة والتنبيهات.
// (اشتراك المشترك النهائي منطقٌ مختلف تماماً في subscription.ts)
//
// المراحل: عادي ← تنبيه (آخر 7 أيام) ← مهلة سماح (3 أيام بعد الانتهاء: يدخل بتحذير) ← منع.
// مهلة السماح تمنع مفاجأة الوكيل بالإيقاف صباحاً وتمنحه فرصة التجديد.

export const WARN_DAYS = 7;   // بدء التنبيه قبل الانتهاء
export const GRACE_DAYS = 3;  // أيام السماح بعد الانتهاء

const DAY = 24 * 3600 * 1000;

export type PlanStatus = "ok" | "warn" | "grace" | "blocked";

export type PlanState = {
  status: PlanStatus;
  daysLeft: number;   // أيام حتى الانتهاء (سالبة بعده). Infinity = بلا انتهاء
  graceLeft: number;  // أيام متبقّية من مهلة السماح (حالة grace فقط)
  expiry: Date | null;
  message: string | null; // نصّ جاهز للعرض/التنبيه
};

// يحسب حالة الاشتراك من تاريخ الانتهاء. بلا تاريخ = دائم (ok).
export function planState(planExpiry: Date | null | undefined, now: Date = new Date()): PlanState {
  if (!planExpiry) return { status: "ok", daysLeft: Infinity, graceLeft: 0, expiry: null, message: null };

  const ms = planExpiry.getTime() - now.getTime();
  const daysLeft = Math.ceil(ms / DAY);

  if (ms > 0) {
    if (daysLeft > WARN_DAYS) return { status: "ok", daysLeft, graceLeft: 0, expiry: planExpiry, message: null };
    const when = daysLeft <= 1 ? "غداً" : `خلال ${daysLeft} أيام`;
    return {
      status: "warn", daysLeft, graceLeft: 0, expiry: planExpiry,
      message: `ينتهي اشتراكك ${when} — يرجى التجديد لتفادي إيقاف الحساب`,
    };
  }

  // انتهى: مهلة سماح ثم منع
  const graceLeft = Math.ceil((planExpiry.getTime() + GRACE_DAYS * DAY - now.getTime()) / DAY);
  if (graceLeft > 0) {
    return {
      status: "grace", daysLeft, graceLeft, expiry: planExpiry,
      message: `انتهى اشتراكك — مهلة سماح ${graceLeft} ${graceLeft === 1 ? "يوم واحد" : "أيام"} فقط، جدّد الآن وإلا أُوقف الحساب`,
    };
  }
  return {
    status: "blocked", daysLeft, graceLeft: 0, expiry: planExpiry,
    message: "انتهت فترة اشتراكك — تواصل مع الإدارة للتجديد",
  };
}

// ═════════════ فرضُ الإيقاف فعلاً — لا عند الدخول وحدَه ═════════════
// كانت حالةُ «منع» تُفحَص في مسار الدخول فقط، وكعكةُ الجلسة عمرُها سنةٌ كاملة
// ⇒ مَن كان داخلاً لحظةَ الانتهاء يبقى بكامل صلاحيّاته سنةً، والتطبيقُ المثبَّت لا يُخرِج أحداً.
// هذه الدالّةُ تجري في getSession/getTechSession فتُبطل الجلسةَ في كلّ طلب.
// وتشمل سحبَ الموافقة والحذفَ الناعم — لهما الثغرةُ عينُها.
// كاشٌ ٦٠ث: الحالةُ تتغيّر بالتاريخ لا بالطلب، فلا يُضاف استعلامٌ لكلّ طلب.
const BLOCK_TTL_MS = 60_000;
const blockCache = new Map<number, { at: number; blocked: boolean }>();

export function clearAgentBlockCache(agentId?: number) {
  if (agentId == null) blockCache.clear();
  else blockCache.delete(agentId);
}

export async function isAgentBlocked(agentId: number | null | undefined): Promise<boolean> {
  if (agentId == null) return false; // مالكُ النظام ومَن لا وكيلَ له
  const now = Date.now();
  const hit = blockCache.get(agentId);
  if (hit && now - hit.at < BLOCK_TTL_MS) return hit.blocked;
  let blocked: boolean;
  try {
    const { prisma } = await import("./prisma");
    const a = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { planExpiry: true, approved: true, isDeleted: true },
    });
    blocked = !a || a.isDeleted || !a.approved || planState(a.planExpiry).status === "blocked";
  } catch (e) {
    // عطلُ قاعدةٍ لا يُقفل وكيلاً يعمل — ولا يُخزَّن في الكاش فتُعاد المحاولة بالطلب التالي
    console.error("[agent-plan] فحصُ اشتراك الوكيل فشل:", e instanceof Error ? e.message : e);
    return false;
  }
  blockCache.set(agentId, { at: now, blocked });
  return blocked;
}
