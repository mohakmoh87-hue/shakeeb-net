import "server-only";
import path from "path";
import fs from "fs";
import type { Client as WAClient } from "whatsapp-web.js";

// ===== خدمة واتساب ويب متعددة المكاتب (whatsapp-web.js) =====
// عميل مستقل لكل مكتب (officeId)، يبقى حيّاً عبر إعادة تحميل الوحدات عبر globalThis.
// جلسة كل مكتب تُحفَظ محلياً (LocalAuth clientId = office-{id}).

export type WaState = "disconnected" | "starting" | "qr" | "authenticated" | "ready" | "error";

type WaStore = {
  client: WAClient | null;
  state: WaState;
  qr: string | null;
  lastError: string | null;
  startedAt: number | null;
};

const g = globalThis as unknown as { __waOffices?: Map<number, WaStore> };
function offices(): Map<number, WaStore> {
  if (!g.__waOffices) g.__waOffices = new Map();
  return g.__waOffices;
}
function store(officeId: number): WaStore {
  const m = offices();
  if (!m.has(officeId)) {
    m.set(officeId, { client: null, state: "disconnected", qr: null, lastError: null, startedAt: null });
  }
  return m.get(officeId)!;
}

const SESSION_DIR = path.join(process.cwd(), ".wwebjs_auth");

// تهيئة وبدء اتصال واتساب لمكتب محدّد (idempotent)
export async function startWhatsApp(officeId: number): Promise<WaState> {
  const s = store(officeId);
  if (s.client && (s.state === "ready" || s.state === "starting" || s.state === "qr" || s.state === "authenticated")) {
    return s.state;
  }
  s.state = "starting";
  s.qr = null;
  s.lastError = null;
  s.startedAt = Date.now();

  // تنظيف ملفات القفل العالقة من إغلاق سابق غير نظيف (انطفاء مفاجئ/تعطّل)،
  // وإلا يعلّق كروميوم عند البدء ولا يظهر رمز QR.
  try {
    const dir = path.join(SESSION_DIR, `session-office-${officeId}`);
    for (const lock of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      const f = path.join(dir, lock);
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }
  } catch { /* تجاهل */ }

  const { Client, LocalAuth } = await import("whatsapp-web.js");
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `office-${officeId}`, dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
  });

  client.on("qr", (qr: string) => { const st = store(officeId); st.qr = qr; st.state = "qr"; });
  client.on("authenticated", () => { const st = store(officeId); st.qr = null; st.state = "authenticated"; });
  client.on("ready", () => { const st = store(officeId); st.qr = null; st.state = "ready"; });
  client.on("auth_failure", (m: string) => { const st = store(officeId); st.state = "error"; st.lastError = `فشل المصادقة: ${m}`; });
  client.on("disconnected", (reason: string) => { const st = store(officeId); st.state = "disconnected"; st.lastError = `انقطع الاتصال: ${reason}`; st.client = null; });

  s.client = client;
  client.initialize().catch((e: unknown) => {
    const st = store(officeId);
    st.state = "error";
    st.lastError = e instanceof Error ? e.message : String(e);
    st.client = null;
  });
  return s.state;
}

export function whatsappStatus(officeId: number): { state: WaState; qr: string | null; error: string | null } {
  const s = store(officeId);
  return { state: s.state, qr: s.qr, error: s.lastError };
}

export async function logoutWhatsApp(officeId: number): Promise<void> {
  const s = store(officeId);
  if (s.client) {
    try { await s.client.logout(); } catch { /* ignore */ }
    try { await s.client.destroy(); } catch { /* ignore */ }
  }
  s.client = null;
  s.state = "disconnected";
  s.qr = null;
}

// تحويل رقم عراقي إلى معرّف واتساب
export function toWaId(phoneRaw: string): string | null {
  let p = (phoneRaw || "").replace(/[^\d+]/g, "");
  if (!p) return null;
  p = p.replace(/^\+/, "").replace(/^00/, "");
  if (p.startsWith("0")) p = "964" + p.slice(1);
  else if (p.length === 10 && p.startsWith("7")) p = "964" + p;
  if (p.length < 11) return null;
  return `${p}@c.us`;
}

export type SendResult = { ok: boolean; error?: string };

// ذاكرة مؤقتة للأرقام المؤكَّد أن لها واتساب (لتفادي إعادة الفحص على خوادم واتساب).
// نُخزّن النتائج الموجبة فقط؛ النتائج السالبة تُعاد فحصها دائماً حتى يظهر التنبيه
// ويختفي فوراً عندما يصبح للرقم واتساب.
const waRegisteredCache = new Map<string, number>();
const WA_POS_TTL = 6 * 60 * 60 * 1000; // 6 ساعات

// فحص هل الرقم مسجَّل في واتساب عبر جلسة واتساب المكتب.
// يُرجِع true (له واتساب) أو false (لا يملك) أو null إذا تعذّر الفحص
// (واتساب المكتب غير متصل، أو لا مكتب، أو الرقم غير صالح).
export async function hasWhatsApp(officeId: number | null | undefined, phone: string): Promise<boolean | null> {
  if (officeId == null) return null;
  const client = ready(officeId);
  if (!client) return null;
  const waId = toWaId(phone);
  if (!waId) return null;
  const digits = waId.replace(/@c\.us$/, "");
  const cached = waRegisteredCache.get(digits);
  if (cached && Date.now() - cached < WA_POS_TTL) return true;
  try {
    const id = await client.getNumberId(digits);
    if (id) { waRegisteredCache.set(digits, Date.now()); return true; }
    return false;
  } catch {
    return null;
  }
}

// ===== واجهة المحادثة (واتساب ويب لكل مكتب) =====
export type WaChat = { id: string; name: string; unread: number; timestamp: number; last: string; isGroup: boolean };
export type WaMessage = { id: string; body: string; fromMe: boolean; timestamp: number; type: string };

function ready(officeId: number): WAClient | null {
  const s = store(officeId);
  return s.state === "ready" && s.client ? s.client : null;
}

// قائمة محادثات مكتب (الأحدث أولاً)
export async function getOfficeChats(officeId: number, limit = 40): Promise<WaChat[]> {
  const client = ready(officeId);
  if (!client) return [];
  const chats = await client.getChats();
  return chats
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, limit)
    .map((c) => ({
      id: c.id._serialized,
      name: c.name || c.id.user,
      unread: c.unreadCount ?? 0,
      timestamp: (c.timestamp ?? 0),
      last: c.lastMessage?.body || (c.lastMessage?.hasMedia ? "📎 وسائط" : ""),
      isGroup: !!c.isGroup,
    }));
}

// رسائل محادثة محدّدة
export async function getOfficeMessages(officeId: number, chatId: string, limit = 40): Promise<WaMessage[]> {
  const client = ready(officeId);
  if (!client) return [];
  const chat = await client.getChatById(chatId);
  const msgs = await chat.fetchMessages({ limit });
  // علّم كمقروءة عند الفتح
  try { await chat.sendSeen(); } catch { /* ignore */ }
  return msgs.map((m) => ({
    id: m.id._serialized,
    body: m.body || (m.hasMedia ? "📎 وسائط" : ""),
    fromMe: !!m.fromMe,
    timestamp: m.timestamp ?? 0,
    type: m.type ?? "chat",
  }));
}

// إرسال رد في محادثة
export async function sendOfficeChat(officeId: number, chatId: string, text: string): Promise<SendResult> {
  const client = ready(officeId);
  if (!client) return { ok: false, error: "واتساب المكتب غير متصل" };
  try {
    await client.sendMessage(chatId, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// إرسال رسالة نصية من واتساب مكتب محدّد
export async function sendWhatsApp(officeId: number | null | undefined, phone: string, text: string): Promise<SendResult> {
  if (officeId == null) return { ok: false, error: "المشترك غير مربوط بمكتب" };
  const s = store(officeId);
  if (s.state !== "ready" || !s.client) {
    return { ok: false, error: `واتساب المكتب غير متصل — اربطه من إدارة المكاتب` };
  }
  const waId = toWaId(phone);
  if (!waId) return { ok: false, error: `رقم غير صالح: ${phone}` };
  try {
    await s.client.sendMessage(waId, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
