import os from "node:os";
import { prisma } from "@/lib/prisma";
import { computeLeaderMachineId } from "@/lib/hybridLeader";

// حالة القيادة على العامل المحلي: القائد فقط يستضيف واتساب ويُرسل ويزامن.
// الافتراضي true حتى تُحسم أول نبضة (حاسبة واحدة = قائد دائماً).
let leaderNow = true;
let mid = "";

export function getMachineId(): string {
  if (!mid) mid = process.env.MACHINE_ID || os.hostname() || `worker-${Math.random().toString(36).slice(2, 8)}`;
  return mid;
}
export function isLeaderNow(): boolean { return leaderNow; }

// نبضة دورية: تسجّل هذه الحاسبة وتحدّث حالة القيادة.
export function startHybridAgent() {
  const g = globalThis as unknown as { __hybridAgentStarted?: boolean };
  if (g.__hybridAgentStarted) return;
  g.__hybridAgentStarted = true;

  const id = getMachineId();
  const name = os.hostname();
  const towerId = process.env.WORKER_TOWER_ID ? Number(process.env.WORKER_TOWER_ID) : null;
  let loggedOk = false;

  async function beat() {
    try {
      await prisma.hybridWorker.upsert({
        where: { machineId: id },
        update: { lastSeen: new Date(), name },
        create: { machineId: id, name, towerId, lastSeen: new Date() },
      });
      const leader = await computeLeaderMachineId();
      leaderNow = leader == null || leader === id;
      if (!loggedOk) { loggedOk = true; console.log(`[hybrid-agent] ✅ سُجّلت الحاسبة (${id}) name=${name} — قائد=${leaderNow}`); }
    } catch (e) {
      console.error("[hybrid-agent] ❌ فشل تسجيل الحاسبة:", e instanceof Error ? e.message : e);
    }
  }
  void beat();
  setInterval(() => { void beat(); }, 20000);
  console.log(`[hybrid-agent] بدأت نبضة الحاسبة (${id})`);
}
