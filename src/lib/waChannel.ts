import { prisma } from "./prisma";
import { decryptSecret } from "./secretbox";
import { isBlockedHost } from "./ssrfGuard";
import type { SendResult } from "./whatsapp";

const DEFAULT_BASE = "https://api.ultramsg.com";

type Stored = { enabled: boolean; provider: string; baseUrl: string; instanceId: string; token: string | null };
export type WaChannel = { enabled: boolean; provider: "ultramsg"; baseUrl: string; instanceId: string; token: string };
export type WaChannelInfo = { enabled: boolean; provider: "ultramsg"; baseUrl: string; instanceId: string; tokenSet: boolean };

function blockedWaHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/\.(nip|sslip|xip)\.io$/.test(h)) return true;
  if (h.includes(":")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export function isSafeWaBase(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (blockedWaHost(u.hostname)) return false;
    if (!u.hostname.includes(".")) return false;
    return true;
  } catch { return false; }
}

export function normalizeWaBase(v: string | null | undefined): string {
  const s = (v ?? "").trim().replace(/\/+$/, "");
  if (!s) return DEFAULT_BASE;
  return isSafeWaBase(s) ? s : DEFAULT_BASE;
}

const KEY = (officeId: number) => `waApi:${officeId}`;

async function readStored(officeId: number): Promise<Stored | null> {
  const row = await prisma.systemSetting.findFirst({ where: { type: KEY(officeId) }, select: { text: true } });
  if (!row?.text) return null;
  try {
    const o = JSON.parse(row.text) as Record<string, unknown>;
    return {
      enabled: o.enabled === true,
      provider: typeof o.provider === "string" ? o.provider : "ultramsg",
      baseUrl: normalizeWaBase(typeof o.baseUrl === "string" ? o.baseUrl : null),
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
  return { enabled: s.enabled, provider: "ultramsg", baseUrl: s.baseUrl, instanceId: s.instanceId, token };
}

export async function getWaChannelInfo(officeId: number): Promise<WaChannelInfo> {
  const s = await readStored(officeId);
  return {
    enabled: s?.enabled === true,
    provider: "ultramsg",
    baseUrl: s?.baseUrl ?? DEFAULT_BASE,
    instanceId: s?.instanceId ?? "",
    tokenSet: !!(s?.token && s.token.length > 0),
  };
}

export async function setWaChannel(
  officeId: number,
  input: { enabled?: boolean; baseUrl?: string; instanceId?: string; token?: string | null },
): Promise<WaChannelInfo> {
  const prev = await readStored(officeId);
  const enabled = input.enabled ?? prev?.enabled ?? false;
  const baseUrl = normalizeWaBase(input.baseUrl ?? prev?.baseUrl);
  const instanceId = (input.instanceId ?? prev?.instanceId ?? "").trim();
  let token = prev?.token ?? null;
  if (typeof input.token === "string" && input.token.trim() !== "") token = input.token.trim();
  await writeText(KEY(officeId), JSON.stringify({ enabled, provider: "ultramsg", baseUrl, instanceId, token }));
  invalidateWaChannel(officeId);
  return { enabled, provider: "ultramsg", baseUrl, instanceId, tokenSet: !!(token && token.length > 0) };
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

async function ultraGet(url: string): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const txt = await res.text();
    try { return JSON.parse(txt) as Record<string, unknown>; } catch { return null; }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function statusAuthenticated(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  const status = data.status;
  if (typeof status === "string") return status.toLowerCase() === "authenticated";
  if (status && typeof status === "object") {
    const acct = (status as Record<string, unknown>).accountStatus;
    const st = acct && typeof acct === "object" ? (acct as Record<string, unknown>).status : undefined;
    if (typeof st === "string") return st.toLowerCase() === "authenticated";
  }
  const acct2 = data.accountStatus;
  if (typeof acct2 === "string") return acct2.toLowerCase() === "authenticated";
  return false;
}

type UltraStatusCache = { connected: boolean; at: number; goodAt: number };
const statusCache = new Map<number, UltraStatusCache>();
const STATUS_TTL = 60_000;
const STATUS_GRACE = 5 * 60_000;

export function invalidateUltraMsgStatus(officeId: number) {
  statusCache.delete(officeId);
}

export async function ultraMsgConnected(officeId: number): Promise<boolean> {
  const cfg = await getWaChannel(officeId);
  if (!cfg) return false;
  const now = Date.now();
  const cached = statusCache.get(officeId);
  if (cached && now - cached.at < STATUS_TTL) return cached.connected;

  const root = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  let host: string;
  try { host = new URL(root).hostname; } catch {
    return cached && now - cached.goodAt < STATUS_GRACE ? cached.connected : false;
  }
  if (await isBlockedHost(host)) return false;
  const instance = /ultramsg\.com/i.test(root) && /^\d+$/.test(cfg.instanceId) ? `instance${cfg.instanceId}` : cfg.instanceId;
  const url = `${root}/${encodeURIComponent(instance)}/instance/status?token=${encodeURIComponent(cfg.token)}`;
  const data = await ultraGet(url);
  if (data == null) {
    if (cached && now - cached.goodAt < STATUS_GRACE) {
      statusCache.set(officeId, { connected: cached.connected, at: now, goodAt: cached.goodAt });
      return cached.connected;
    }
    statusCache.set(officeId, { connected: false, at: now, goodAt: cached?.goodAt ?? 0 });
    return false;
  }
  const connected = statusAuthenticated(data);
  statusCache.set(officeId, { connected, at: now, goodAt: now });
  return connected;
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
    if (data) {
      const sentTrue = data.sent === "true" || data.sent === true;
      const okTrue = data.ok === true || data.queued === true || data.success === true;
      const st = typeof data.status === "string" ? data.status.toLowerCase() : "";
      const statusOk = st === "success" || st === "queued" || st === "sent" || st === "ok";
      const hasId = typeof data.id === "string" && data.id.length > 0;
      const errText = typeof data.error === "string" && data.error ? data.error
        : (typeof data.message === "string" && /error|fail|wrong|invalid|not\s/i.test(data.message)) ? data.message : "";
      if (!errText && (sentTrue || okTrue || statusOk || hasId)) return { ok: true };
      if (errText) return { ok: false, definite: true, error: errText };
    } else if (/"(sent|ok|queued|success)"\s*:\s*(true|"true")/i.test(txt)) {
      return { ok: true };
    }
    return { ok: false, definite: true, error: txt ? txt.slice(0, 200) : "استجابةٌ غير متوقّعة من بوّابة الواتساب" };
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
  const root = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  let host: string;
  try { host = new URL(root).hostname; } catch { return { ok: false, error: "رابطُ واتساب غير صالح" }; }
  if (await isBlockedHost(host)) return { ok: false, error: "مضيفُ واتساب غير مسموح — عنوانٌ داخليّ" };
  const instance = /ultramsg\.com/i.test(root) && /^\d+$/.test(cfg.instanceId) ? `instance${cfg.instanceId}` : cfg.instanceId;
  const base = `${root}/${encodeURIComponent(instance)}`;
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
