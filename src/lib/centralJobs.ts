import { prisma } from "./prisma";

export const CENTRAL_JOBS = process.env.CENTRAL_JOBS === "1";
const BEAT_TYPE = "centralJobsBeat";
export const CENTRAL_BEAT_FRESH_MS = 3 * 60_000;
const BEAT_WRITE_MS = 60_000;

async function upsertBeat(value: string): Promise<void> {
  const r = await prisma.systemSetting.findFirst({ where: { type: BEAT_TYPE }, select: { id: true }, orderBy: { id: "asc" } });
  if (r) await prisma.systemSetting.update({ where: { id: r.id }, data: { value } });
  else await prisma.systemSetting.create({ data: { type: BEAT_TYPE, value } });
}

const g = globalThis as unknown as { __centralBeat?: boolean };
export function startCentralHeartbeat(): void {
  if (!CENTRAL_JOBS || g.__centralBeat) return;
  g.__centralBeat = true;
  const beat = () => void upsertBeat(String(Date.now())).catch((e) => console.error("[central] نبضة:", e instanceof Error ? e.message : e));
  beat();
  setInterval(beat, BEAT_WRITE_MS);
  console.log("[central] النبضةُ المركزيّة انطلقت");
}

export async function centralBeatFresh(): Promise<boolean> {
  const r = await prisma.systemSetting.findFirst({ where: { type: BEAT_TYPE }, select: { value: true }, orderBy: { id: "asc" } });
  const t = Number(r?.value);
  return Number.isFinite(t) && Date.now() - t < CENTRAL_BEAT_FRESH_MS;
}
