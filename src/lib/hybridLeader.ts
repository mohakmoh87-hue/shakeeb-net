import { prisma } from "@/lib/prisma";

// حاسبة تُعدّ "متصلة" إن أرسلت نبضة خلال آخر 60 ثانية
export const ONLINE_WINDOW_MS = 60 * 1000;

// القائد = الحاسبة المتصلة صاحبة أصغر أولوية (ثم أصغر id) — هي مضيف واتساب لكل المكاتب.
export async function computeLeaderMachineId(): Promise<string | null> {
  const since = new Date(Date.now() - ONLINE_WINDOW_MS);
  // فقط الحواسيب المُعتمَدة (approved) المتصلة مؤهّلة للقيادة
  const online = await prisma.hybridWorker.findMany({
    where: { approved: true, lastSeen: { gte: since } },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: 1,
    select: { machineId: true },
  });
  return online[0]?.machineId ?? null;
}

export function isOnline(lastSeen: Date): boolean {
  return Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_MS;
}
