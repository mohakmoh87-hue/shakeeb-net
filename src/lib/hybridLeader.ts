import { prisma } from "@/lib/prisma";

// حاسبة تُعدّ "متصلة" إن أرسلت نبضة خلال آخر 60 ثانية
export const ONLINE_WINDOW_MS = 60 * 1000;

// قائد وكيل محدّد = حاسبته المتصلة المُعتمَدة صاحبة أصغر أولوية (ثم أصغر id).
// كل وكيل له قائده الخاص، يستضيف واتساب مكاتب هذا الوكيل فقط (عزل بين الوكلاء).
export async function computeLeaderMachineId(agentId: number | null | undefined): Promise<string | null> {
  if (agentId == null) return null;
  const since = new Date(Date.now() - ONLINE_WINDOW_MS);
  const online = await prisma.hybridWorker.findMany({
    where: { approved: true, agentId, lastSeen: { gte: since } },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: 1,
    select: { machineId: true },
  });
  return online[0]?.machineId ?? null;
}

export function isOnline(lastSeen: Date): boolean {
  return Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_MS;
}
