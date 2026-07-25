import { prisma } from "@/lib/prisma";
import { planState } from "@/lib/agentPlan";

// شريط تنبيه انتهاء اشتراك الوكيل — يظهر بأعلى كل الصفحات في آخر 7 أيام (أصفر)
// وأثناء مهلة السماح بعد الانتهاء (أحمر). لا يظهر إطلاقاً في الحالة العادية.
export default async function PlanBanner({ agentId }: { agentId: number | null }) {
  if (agentId == null) return null;
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { planExpiry: true } });
  const st = planState(agent?.planExpiry ?? null);
  if (st.status !== "warn" && st.status !== "grace") return null;

  const grace = st.status === "grace";
  return (
    <div
      className={`px-3 py-2 text-center text-sm font-bold ${
        grace ? "bg-red-600 text-white" : "bg-amber-100 text-amber-900"
      }`}
    >
      {grace ? "⛔" : "⚠️"} {st.message}
    </div>
  );
}
