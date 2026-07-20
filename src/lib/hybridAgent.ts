import os from "node:os";
import { prisma } from "@/lib/prisma";
import { computeLeaderMachineId } from "@/lib/hybridLeader";

// حالة القيادة على العامل المحلي: قائد الوكيل فقط يستضيف واتساب مكاتب وكيله.
// الافتراضي false حتى تُحسم أول نبضة (لا يُصبح قائداً إلا بعد اعتماده وربطه بوكيل).
let leaderNow = false;
let myAgentId: number | null = null; // وكيل هذه الحاسبة (يُقرأ من صفّها بعد الاعتماد)
let mid = "";

export function getMachineId(): string {
  if (!mid) mid = process.env.MACHINE_ID || os.hostname() || `worker-${Math.random().toString(36).slice(2, 8)}`;
  return mid;
}
export function isLeaderNow(): boolean { return leaderNow; }
// وكيل هذه الحاسبة (لحصر جلسات الواتساب بمكاتب هذا الوكيل)
export function getWorkerAgentId(): number | null { return myAgentId; }

// نبضة دورية: تسجّل هذه الحاسبة وتحدّث حالة القيادة.
export function startHybridAgent() {
  const g = globalThis as unknown as { __hybridAgentStarted?: boolean };
  if (g.__hybridAgentStarted) return;
  g.__hybridAgentStarted = true;

  const id = getMachineId();
  const name = os.hostname();
  const towerId = process.env.WORKER_TOWER_ID ? Number(process.env.WORKER_TOWER_ID) : null;
  let loggedOk = false;

  let timer: ReturnType<typeof setInterval> | null = null;
  async function beat() {
    try {
      const row = await prisma.hybridWorker.upsert({
        where: { machineId: id },
        update: { lastSeen: new Date(), name },
        create: { machineId: id, name, towerId, lastSeen: new Date() },
        select: { agentId: true, approved: true, blocked: true },
      });
      // محظورة (حذفها المدير): توقّف تماماً — أغلق الواتساب نظيفاً ثم اخرج (لا تعد للظهور)
      if (row.blocked) {
        console.log(`[hybrid-agent] ⛔ هذه الحاسبة (${id}) محظورة من المدير — إيقاف العامل.`);
        leaderNow = false;
        if (timer) { clearInterval(timer); timer = null; }
        try { const { destroyAllWhatsApp } = await import("@/lib/whatsapp"); await destroyAllWhatsApp(); } catch { /* تجاهل */ }
        process.exit(0);
      }
      myAgentId = row.agentId ?? null;
      // قائد وكيل هذه الحاسبة فقط (يستضيف واتساب مكاتب هذا الوكيل). غير معتمَد/بلا وكيل ⇒ ليس قائداً.
      if (row.approved && myAgentId != null) {
        const leader = await computeLeaderMachineId(myAgentId);
        leaderNow = leader === id;
      } else {
        leaderNow = false;
      }
      if (!loggedOk) { loggedOk = true; console.log(`[hybrid-agent] ✅ سُجّلت الحاسبة (${id}) name=${name} — وكيل=${myAgentId} قائد=${leaderNow}`); }
    } catch (e) {
      console.error("[hybrid-agent] ❌ فشل تسجيل الحاسبة:", e instanceof Error ? e.message : e);
    }
  }
  void beat();
  timer = setInterval(() => { void beat(); }, 20000);
  console.log(`[hybrid-agent] بدأت نبضة الحاسبة (${id})`);
}
