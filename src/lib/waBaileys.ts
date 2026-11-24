import path from "path";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import type { WaState, SendResult } from "@/lib/whatsapp";

type Baileys = typeof import("@whiskeysockets/baileys");
type WASock = ReturnType<Baileys["default"]>;

type BStore = {
  sock: WASock | null;
  state: WaState;
  qr: string | null;
  error: string | null;
  startedAt: number | null;
  qrAt: number | null;
  stopped: boolean;
};

const g = globalThis as unknown as { __waBaileys?: Map<number, BStore> };
function offices(): Map<number, BStore> {
  if (!g.__waBaileys) g.__waBaileys = new Map();
  return g.__waBaileys;
}
function store(officeId: number): BStore {
  const m = offices();
  if (!m.has(officeId)) m.set(officeId, { sock: null, state: "disconnected", qr: null, error: null, startedAt: null, qrAt: null, stopped: true });
  return m.get(officeId)!;
}

const AUTH_DIR = path.join(process.cwd(), ".baileys_auth");
const authPath = (officeId: number) => path.join(AUTH_DIR, `office-${officeId}`);

function publish(officeId: number) {
  const s = store(officeId);
  const mid = process.env.MACHINE_ID || null;
  const own = s.state === "ready" && mid ? { hostMachineId: mid } : {};
  prisma.waSession.upsert({
    where: { towerId: officeId },
    update: { state: s.state, qr: s.qr, error: s.error, ...own },
    create: { towerId: officeId, state: s.state, qr: s.qr, error: s.error, ...own },
  }).catch(() => { });
}

let mod: Baileys | null = null;
async function lib(): Promise<Baileys> {
  if (!mod) mod = await import("@whiskeysockets/baileys");
  return mod;
}

type Logger = NonNullable<Parameters<Baileys["makeCacheableSignalKeyStore"]>[1]>;
let loggerCache: Logger | null = null;
async function logger(): Promise<Logger> {
  if (!loggerCache) {
    const pino = (await import("pino")).default;
    loggerCache = pino({ level: process.env.WA_LOG_LEVEL || "silent" }) as unknown as Logger;
  }
  return loggerCache;
}

type WAVersion = [number, number, number];
let waVersion: WAVersion | null = null;
async function version(): Promise<WAVersion | null> {
  if (waVersion) return waVersion;
  try {
    const b = await lib();
    const r = await Promise.race([
      b.fetchLatestBaileysVersion(),
      new Promise<null>((res) => setTimeout(() => res(null), 8000)),
    ]);
    const v = (r as { version?: WAVersion } | null)?.version;
    if (Array.isArray(v)) waVersion = v;
  } catch { }
  return waVersion;
}

// ═════ اختيارُ المحرّك ═════
// whatsapp-web.js مكسورٌ عالميّاً (واتساب حذف الوحدةَ التي يحقنها)، فالمحرّكُ الافتراضيُّ
// صار Baileys لكلّ مكتب. ومنفذُ هروبٍ عبر البيئة `WA_WWEBJS_OFFICES` (قائمةُ أرقام مكاتب)
// يُبقي مكتباً بعينه على القديم عند الحاجة. متزامنٌ (بيئةٌ لا قاعدة) ليُستدعى من دوالّ
// الحالة المتزامنة.
export function isBaileysOffice(officeId: number): boolean {
  const ex = String(process.env.WA_WWEBJS_OFFICES ?? "").split(/[,\s]+/).map((s) => Number(s.trim()));
  return !ex.includes(officeId);
}

export function baileysReadyLocal(officeId: number): boolean {
  const s = store(officeId);
  return s.state === "ready" && !!s.sock;
}

export function baileysStatus(officeId: number): { state: WaState; qr: string | null; error: string | null } {
  const s = store(officeId);
  return { state: s.state, qr: s.qr, error: s.error };
}

export async function startBaileys(officeId: number): Promise<WaState> {
  const s = store(officeId);
  if (s.sock) return s.state;
  if (s.state === "starting" && s.startedAt && Date.now() - s.startedAt < 90_000) return s.state;

  s.stopped = false;
  s.startedAt = Date.now();
  s.state = "starting";
  s.qr = null;
  s.error = null;
  publish(officeId);

  try {
  const b = await lib();
  const log = await logger();
  fs.mkdirSync(authPath(officeId), { recursive: true });
  const { state, saveCreds } = await b.useMultiFileAuthState(authPath(officeId));
  const ver = await version();

  const sock = b.default({
    ...(ver ? { version: ver } : {}),
    auth: { creds: state.creds, keys: b.makeCacheableSignalKeyStore(state.keys, log) },
    logger: log,
    browser: b.Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 30_000,
    keepAliveIntervalMs: 25_000,
  });
  s.sock = sock;
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (u) => {
    if (store(officeId).sock !== sock) return;
    const { connection, lastDisconnect, qr } = u;
    if (qr) { s.qr = qr; s.state = "qr"; s.qrAt = Date.now(); publish(officeId); }
    if (connection === "connecting" && s.state !== "qr") { s.state = "starting"; publish(officeId); }
    if (connection === "open") {
      s.state = "ready"; s.qr = null; s.error = null; publish(officeId);
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      s.sock = null;
      if (s.stopped) return;
      if (code === b.DisconnectReason.loggedOut) {
        try { fs.rmSync(authPath(officeId), { recursive: true, force: true }); } catch { }
        s.state = "disconnected"; s.error = "فُصل هذا الجهاز من هاتف المكتب — أعد الربط"; s.stopped = true; publish(officeId);
        return;
      }
      if (code === b.DisconnectReason.forbidden) {
        s.state = "error"; s.error = "واتساب رفض هذا الرقم (قد يكون محظوراً أو مقيَّداً)"; s.stopped = true; publish(officeId);
        return;
      }
      s.state = "disconnected"; s.error = null; publish(officeId);
      setTimeout(() => { if (!store(officeId).stopped && !store(officeId).sock) void startBaileys(officeId).catch(() => { }); }, 3000);
    }
  });
  } catch (e) {
    s.state = "error"; s.error = e instanceof Error ? e.message : String(e); s.sock = null; publish(officeId);
  }
  return s.state;
}

function toJid(phoneRaw: string): string | null {
  const d = String(phoneRaw).replace(/\D/g, "");
  return d ? `${d}@s.whatsapp.net` : null;
}

export async function sendBaileys(officeId: number, phone: string, text: string, image?: string | null): Promise<SendResult> {
  const s = store(officeId);
  if (s.state !== "ready" || !s.sock) return { ok: false, error: "واتساب المكتب غير متصل — اربطه من إدارة المكاتب" };
  const sock = s.sock;
  const base = toJid(phone);
  if (!base) return { ok: false, error: `رقم غير صالح: ${phone}` };
  let jid = base;
  try {
    const digits = base.replace(/@s\.whatsapp\.net$/, "");
    const res = (await sock.onWhatsApp(digits))?.[0];
    if (!res?.exists) return { ok: false, error: "الرقم ليس له واتساب" };
    jid = res.jid;
  } catch { }

  try {
    let imageNote: string | null = null;
    if (image) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(image);
      if (m) {
        await sock.sendMessage(jid, { image: Buffer.from(m[2], "base64"), caption: text });
        return { ok: true, withImage: true };
      }
      imageNote = `صيغةُ الصورة غير صالحة (لا تبدأ بـdata:…;base64) — طولُها ${image.length}`;
    }
    await sock.sendMessage(jid, { text });
    return imageNote ? { ok: true, imageError: imageNote } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function logoutBaileys(officeId: number): Promise<void> {
  const s = store(officeId);
  s.stopped = true;
  try { await s.sock?.logout(); } catch { }
  try { s.sock?.end(undefined); } catch { }
  s.sock = null;
  try { fs.rmSync(authPath(officeId), { recursive: true, force: true }); } catch { }
  s.state = "disconnected"; s.qr = null; s.error = null;
  publish(officeId);
}

export async function destroyBaileys(officeId: number): Promise<void> {
  const s = store(officeId);
  s.stopped = true;
  try { s.sock?.end(undefined); } catch { }
  s.sock = null;
}

export async function destroyAllBaileys(): Promise<void> {
  for (const id of offices().keys()) await destroyBaileys(id);
}
