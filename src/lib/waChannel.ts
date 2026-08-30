import { prisma } from "./prisma";
import { decryptSecret } from "./secretbox";
import type { SendResult } from "./whatsapp";

type Stored = { enabled: boolean; provider: string; instanceId: string; token: string | null };
export type WaChannel = { enabled: boolean; provider: "ultramsg"; instanceId: string; token: string };
export type WaChannelInfo = { enabled: boolean; provider: "ultramsg"; instanceId: string; tokenSet: boolean };

const KEY = (officeId: number) => `waApi:${officeId}`;

async function readStored(officeId: number): Promise<Stored | null> {
  const row = await prisma.systemSetting.findFirst({ where: { type: KEY(officeId) }, select: { text: true } });
  if (!row?.text) return null;
  try {
    const o = JSON.parse(row.text) as Record<string, unknown>;
    return {
      enabled: o.enabled === true,
      provider: typeof o.provider === "string" ? o.provider : "ultramsg",
      instanceId: typeof o.instanceId === "string" ? o.instanceId.trim() : "",
      token: typeof o.token === "string" ? o.token : null,
    };
  } catch {
    return null;
  }
}

async function writeText(type: string, text: string) {
  const r = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true } });
  if (r) await prisma.systemSetting.update({ where: { id: r.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
}

export async function loadWaChannel(officeId: number): Promise<WaChannel | null> {
  const s = await readStored(officeId);
  if (!s || !s.instanceId) return null;
  const token = decryptSecret(s.token) ?? "";
  return { enabled: s.enabled, provider: "ultramsg", instanceId: s.instanceId, token };
}

export async function getWaChannelInfo(officeId: number): Promise<WaChannelInfo> {
  const s = await readStored(officeId);
  return {
    enabled: s?.enabled === true,
    provider: "ultramsg",
    instanceId: s?.instanceId ?? "",
    tokenSet: !!(s?.token && s.token.length > 0),
  };
}

export async function setWaChannel(
  officeId: number,
  input: { enabled?: boolean; instanceId?: string; token?: string | null },
): Promise<WaChannelInfo> {
  const prev = await readStored(officeId);
  const enabled = input.enabled ?? prev?.enabled ?? false;
  const instanceId = (input.instanceId ?? prev?.instanceId ?? "").trim();
  let token = prev?.token ?? null;
  if (typeof input.token === "string" && input.token.trim() !== "") token = input.token.trim();
  await writeText(KEY(officeId), JSON.stringify({ enabled, provider: "ultramsg", instanceId, token }));
  invalidateWaChannel(officeId);
  return { enabled, provider: "ultramsg", instanceId, tokenSet: !!(token && token.length > 0) };
}

const cache = new Map<number, { cfg: WaChannel | null; at: number }>();
const TTL_MS = 20_000;

export function invalidateWaChannel(officeId: number) {
  cache.delete(officeId);
}

export async function getWaChannel(officeId: number): Promise<WaChannel | null> {
  const now = Date.now();
  const c = cache.get(officeId);
  if (c && now - c.at < TTL_MS) return c.cfg;
  const full = await loadWaChannel(officeId).catch(() => null);
  const cfg = full && full.enabled && full.instanceId && full.token ? full : null;
  cache.set(officeId, { cfg, at: now });
  return cfg;
}

export async function listUltraMsgOffices(): Promise<number[]> {
  const rows = await prisma.systemSetting.findMany({ where: { type: { startsWith: "waApi:" } }, select: { type: true, text: true } });
  const ids: number[] = [];
  for (const r of rows) {
    if (!r.type || !r.text) continue;
    try {
      const o = JSON.parse(r.text) as Record<string, unknown>;
      if (o.enabled === true && typeof o.instanceId === "string" && o.instanceId.trim() && typeof o.token === "string" && o.token) {
        const id = Number(r.type.slice("waApi:".length));
        if (Number.isFinite(id)) ids.push(id);
      }
    } catch { /* skip */ }
  }
  return ids;
}

function toUltraTo(phoneRaw: string): string | null {
  let p = (phoneRaw || "").replace(/[^\d+]/g, "");
  if (!p) return null;
  p = p.replace(/^\+/, "").replace(/^00/, "");
  if (p.startsWith("0")) p = "964" + p.slice(1);
  else if (p.length === 10 && p.startsWith("7")) p = "964" + p;
  if (p.length < 11) return null;
  return "+" + p;
}

async function ultraPost(url: string, params: Record<string, string>): Promise<{ ok: boolean; error?: string; definite?: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let data: Record<string, unknown> | null = null;
    try { data = JSON.parse(txt) as Record<string, unknown>; } catch { /* not JSON */ }
    if (!res.ok) {
      const e = data && (typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : "");
      return { ok: false, definite: true, error: `UltraMsg HTTP ${res.status}${e ? `: ${e}` : ""}` };
    }
    if (data && (data.sent === "true" || data.sent === true)) return { ok: true };
    const err = (data && (data.error ?? data.message)) ?? (txt ? txt.slice(0, 200) : "استجابةٌ غير متوقّعة من UltraMsg");
    return { ok: false, definite: true, error: typeof err === "string" ? err : JSON.stringify(err) };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { ok: false, definite: false, error: "انتهت مهلةُ الاتصال بـUltraMsg" };
    return { ok: false, definite: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendViaUltraMsg(cfg: WaChannel, phone: string, text: string, image?: string | null): Promise<SendResult> {
  const to = toUltraTo(phone);
  if (!to) return { ok: false, error: "رقمٌ غير صالحٍ لواتساب" };
  const base = `https://api.ultramsg.com/${encodeURIComponent(cfg.instanceId)}`;
  if (image) {
    const r = await ultraPost(`${base}/messages/image`, { token: cfg.token, to, image, caption: text });
    if (r.ok) return { ok: true, withImage: true };
    if (!r.definite) return { ok: false, error: r.error ?? "تعذّر تأكيدُ إرسال الصورة عبر UltraMsg" };
    const t = await ultraPost(`${base}/messages/chat`, { token: cfg.token, to, body: text });
    if (t.ok) return { ok: true, imageError: r.error ?? "تعذّر إرسالُ الصورة عبر UltraMsg" };
    return { ok: false, error: t.error ?? "فشل الإرسال عبر UltraMsg" };
  }
  const r = await ultraPost(`${base}/messages/chat`, { token: cfg.token, to, body: text });
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "فشل الإرسال عبر UltraMsg" };
}
