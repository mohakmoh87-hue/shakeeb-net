import { prisma } from "./prisma";
import { encryptSecret, decryptSecret } from "./secretbox";
import { sendViaUltraMsg, type WaChannel } from "./waChannel";
import type { SendResult } from "./whatsapp";

const KEY = "otpWa";

type Stored = { instanceId: string; token: string | null };
export type OtpWaInfo = { instanceId: string; tokenSet: boolean };

async function readStored(): Promise<Stored | null> {
  const row = await prisma.systemSetting.findFirst({ where: { type: KEY }, select: { text: true } });
  if (!row?.text) return null;
  try {
    const o = JSON.parse(row.text) as Record<string, unknown>;
    return {
      instanceId: typeof o.instanceId === "string" ? o.instanceId.trim() : "",
      token: typeof o.token === "string" ? o.token : null,
    };
  } catch {
    return null;
  }
}

async function writeText(text: string) {
  const r = await prisma.systemSetting.findFirst({ where: { type: KEY }, select: { id: true } });
  if (r) await prisma.systemSetting.update({ where: { id: r.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type: KEY, text } });
}

export async function loadOtpWa(): Promise<WaChannel | null> {
  const s = await readStored();
  if (!s || !s.instanceId) return null;
  const token = decryptSecret(s.token) ?? "";
  return { enabled: true, provider: "ultramsg", instanceId: s.instanceId, token };
}

export async function getOtpWaInfo(): Promise<OtpWaInfo> {
  const s = await readStored();
  return { instanceId: s?.instanceId ?? "", tokenSet: !!(s?.token && s.token.length > 0) };
}

export async function setOtpWa(input: { instanceId?: string; token?: string | null }): Promise<OtpWaInfo> {
  const prev = await readStored();
  const instanceId = (input.instanceId ?? prev?.instanceId ?? "").trim();
  let token = prev?.token ?? null;
  if (typeof input.token === "string" && input.token.trim() !== "") token = encryptSecret(input.token.trim());
  await writeText(JSON.stringify({ instanceId, token }));
  return { instanceId, tokenSet: !!(token && token.length > 0) };
}

export async function sendOtpWhatsApp(phone: string, text: string): Promise<SendResult> {
  const cfg = await loadOtpWa();
  if (!cfg || !cfg.instanceId || !cfg.token) return { ok: false, error: "لم يُربَط واتساب OTP بعد" };
  return sendViaUltraMsg(cfg, phone, text);
}
