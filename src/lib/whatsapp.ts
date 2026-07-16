import path from "path";
import fs from "fs";
import type { Client as WAClient } from "whatsapp-web.js";
import { prisma } from "@/lib/prisma";

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

// نشر حالة/رمز الواتساب لهذا المكتب إلى السحابة (Neon) ليقرأها الموقع ويعرض الـQR من الإنترنت
function publish(officeId: number) {
  const s = store(officeId);
  prisma.waSession.upsert({
    where: { towerId: officeId },
    update: { state: s.state, qr: s.qr, error: s.lastError },
    create: { towerId: officeId, state: s.state, qr: s.qr, error: s.lastError },
  }).catch(() => { /* لا نُفشل الواتساب بسبب النشر */ });
}

// تهيئة وبدء اتصال واتساب لمكتب محدّد (idempotent)
const STARTUP_TIMEOUT_MS = 75_000; // إن لم يظهر QR/يجهز خلال هذه المدة نعتبر الإقلاع عالقاً

export async function startWhatsApp(officeId: number): Promise<WaState> {
  const s = store(officeId);
  // جاهز/يعرض QR → أعِد الحالة كما هي
  if (s.client && (s.state === "ready" || s.state === "authenticated" || s.state === "qr")) {
    return s.state;
  }
  // ما زال يقلع حديثاً → دعه يكمل
  if (s.client && s.state === "starting" && s.startedAt && Date.now() - s.startedAt < STARTUP_TIMEOUT_MS) {
    return s.state;
  }
  // إقلاع عالق/قديم (Chromium لم يستجب) → اهدم العميل وأعد التشغيل من جديد
  if (s.client) {
    try { s.client.destroy?.().catch(() => {}); } catch { /* تجاهل */ }
    s.client = null;
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

  console.log(`[whatsapp] بدء إقلاع واتساب مكتب ${officeId}...`);
  // تحميل المكتبة (CJS) بأمان: نجرّب require المباشر أولاً (يعمل مع tsx/Node)،
  // ثم import مع مراعاة تداخل default — لأن الصادرات قد تُوضَع تحت default.
  let Client: typeof import("whatsapp-web.js").Client;
  let LocalAuth: typeof import("whatsapp-web.js").LocalAuth;
  try {
    const pick = (o: unknown): Record<string, unknown> | null => {
      const r = o as Record<string, unknown> | null;
      return r && (typeof r.Client === "function" || typeof r.LocalAuth === "function") ? r : null;
    };
    let mod: Record<string, unknown> | null = null;
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(path.join(process.cwd(), "wa-require.cjs"));
      mod = pick(req("whatsapp-web.js"));
    } catch { /* نجرّب import أدناه */ }
    if (!mod) {
      const wa = (await import("whatsapp-web.js")) as unknown as Record<string, unknown>;
      mod = pick(wa) ?? pick(wa.default) ?? pick((wa.default as Record<string, unknown>)?.default);
    }
    if (!mod) throw new Error("Client/LocalAuth غير متاحين من whatsapp-web.js (interop)");
    Client = mod.Client as typeof Client;
    LocalAuth = mod.LocalAuth as typeof LocalAuth;
  } catch (e) {
    s.state = "error";
    s.lastError = `فشل تحميل مكتبة الواتساب: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[whatsapp] ❌", s.lastError);
    publish(officeId);
    return s.state;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `office-${officeId}`, dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
  });

  client.on("qr", (qr: string) => { const st = store(officeId); st.qr = qr; st.state = "qr"; publish(officeId); console.log(`[whatsapp] ✅ QR جاهز لمكتب ${officeId}`); });
  client.on("authenticated", () => { const st = store(officeId); st.qr = null; st.state = "authenticated"; publish(officeId); });
  client.on("ready", () => { const st = store(officeId); st.qr = null; st.state = "ready"; publish(officeId); });
  client.on("auth_failure", (m: string) => { const st = store(officeId); st.state = "error"; st.lastError = `فشل المصادقة: ${m}`; publish(officeId); });
  client.on("disconnected", (reason: string) => { const st = store(officeId); st.state = "disconnected"; st.lastError = `انقطع الاتصال: ${reason}`; st.client = null; publish(officeId); });

  s.client = client;
  publish(officeId); // نشر حالة "starting"
  const startedFor = s.startedAt;
  client.initialize().catch((e: unknown) => {
    const st = store(officeId);
    st.state = "error";
    st.lastError = e instanceof Error ? e.message : String(e);
    try { st.client?.destroy?.().catch(() => {}); } catch { /* تجاهل */ }
    st.client = null;
    publish(officeId);
  });
  // مراقب: إن بقي عالقاً في "starting" بعد المهلة نُعلن خطأً ونهدم العميل (فتتوقّف الواجهة عن التحميل ويمكن إعادة المحاولة)
  setTimeout(() => {
    const st = store(officeId);
    if (st.startedAt === startedFor && st.state === "starting") {
      st.state = "error";
      st.lastError = "تعذّر إقلاع متصفّح الواتساب — أعد المحاولة";
      try { st.client?.destroy?.().catch(() => {}); } catch { /* تجاهل */ }
      st.client = null;
      publish(officeId);
    }
  }, STARTUP_TIMEOUT_MS);
  return s.state;
}

// مستطلِع طلبات الاتصال من الموقع: القائد يلتقط requestedAt ويبدأ واتساب المكتب فيُنشَر الـQR للسحابة.
export function startWaRequestPoller() {
  const gg = globalThis as unknown as { __waPollerStarted?: boolean };
  if (gg.__waPollerStarted) return;
  gg.__waPollerStarted = true;
  setInterval(async () => {
    try {
      const { isLeaderNow } = await import("@/lib/hybridAgent");
      if (!isLeaderNow()) return; // القائد فقط يستضيف واتساب
      const since = new Date(Date.now() - 120_000); // طلبات آخر دقيقتين
      // نقرأ الحالة المنشورة + طلب الاتصال لكل المكاتب معاً
      const rows = await prisma.waSession.findMany({ select: { towerId: true, state: true, requestedAt: true } });
      for (const r of rows) {
        const st = store(r.towerId);
        const alive = st.client && (st.state === "ready" || st.state === "qr" || st.state === "authenticated" || st.state === "starting");
        // فصل مطلوب من الموقع: القاعدة تقول "disconnected" بينما الوكيل ما زال يحمل عميلاً حيّاً
        if (r.state === "disconnected" && alive) {
          console.log(`[whatsapp] طلب فصل من الموقع لمكتب ${r.towerId} — تنفيذ الفصل وحذف الجلسة`);
          await logoutWhatsApp(r.towerId);
          continue;
        }
        // اتصال مطلوب: requestedAt حديث والوكيل غير نشط
        if (r.requestedAt && r.requestedAt >= since && !alive) {
          void startWhatsApp(r.towerId);
        }
      }
    } catch { /* تجاهل */ }
  }, 8000);
}

export function whatsappStatus(officeId: number): { state: WaState; qr: string | null; error: string | null } {
  const s = store(officeId);
  return { state: s.state, qr: s.qr, error: s.lastError };
}

// حذف مجلد جلسة مكتب محفوظة (LocalAuth) — يمنع بقاء تسجيل دخول قديم عالق
function deleteSessionDir(officeId: number) {
  try {
    const dir = path.join(SESSION_DIR, `session-office-${officeId}`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* أفضل جهد — قد يبقى قفل مؤقت على ويندوز */ }
}

// فصل واتساب مكتب: يُلغي الربط على واتساب، يهدم المتصفّح، ويحذف الجلسة المحفوظة
// فوراً (حتى لا تبقى جلسة قديمة تُسبّب عُلوق "جاري البدء" لاحقاً).
export async function logoutWhatsApp(officeId: number): Promise<void> {
  const s = store(officeId);
  const withTimeout = <T>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise((res) => setTimeout(res, ms))]);
  if (s.client) {
    // logout يُلغي الربط من خوادم واتساب؛ قد يعلّق فنحدّه بمهلة
    try { await withTimeout(Promise.resolve(s.client.logout()), 8000); } catch { /* ignore */ }
    try { await withTimeout(Promise.resolve(s.client.destroy()), 8000); } catch { /* ignore */ }
  }
  s.client = null;
  s.state = "disconnected";
  s.qr = null;
  s.lastError = null;
  s.startedAt = null;
  deleteSessionDir(officeId); // امسح كل أثر للجلسة فور الفصل
  publish(officeId); // انشر "disconnected" للسحابة فوراً
}

// حالة واتساب المكاتب كما نشرها الوكيل في السحابة (Neon) — تقرأها كل مسارات الموقع.
// مهمّة لأن الموقع (Vercel) لا يملك عميل واتساب في ذاكرته؛ الحالة الحقيقية في القاعدة.
// إن لم يوجد قائد متصل (وكيل مُعتمَد نشط)، لا شيء يستضيف واتساب فعلياً ⇒ الكل "غير متصل".
export async function readOfficeStates(officeIds: number[]): Promise<Record<number, WaState>> {
  const out: Record<number, WaState> = {};
  for (const id of officeIds) out[id] = "disconnected";
  if (officeIds.length === 0) return out;
  const leader = await prisma.hybridWorker.findFirst({
    where: { approved: true, lastSeen: { gte: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (!leader) return out; // لا وكيل نشط ⇒ لا اتصال واتساب
  const rows = await prisma.waSession.findMany({
    where: { towerId: { in: officeIds } },
    select: { towerId: true, state: true },
  });
  for (const r of rows) out[r.towerId] = (r.state as WaState) ?? "disconnected";
  return out;
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

// ===== مُرحِّل عمليات واتساب (الموقع ↔ الوكيل) =====
// الموقع لا يملك عميل واتساب؛ فيرسل الطلب عبر جدول wa_relays، ويُنفّذه الوكيل القائد.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// (على الموقع) أنشئ طلباً وانتظر نتيجته من الوكيل — مع مهلة.
export async function relayRequest(
  towerId: number,
  kind: "chats" | "messages" | "send" | "logout",
  params: Record<string, unknown> = {},
  timeoutMs = 9000,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  // لا فائدة من الطلب إن لا يوجد وكيل نشط
  const leader = await prisma.hybridWorker.findFirst({
    where: { approved: true, lastSeen: { gte: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (!leader) return { ok: false, error: "وكيل المكتب غير متصل — لا يمكن جلب المحادثات" };

  const row = await prisma.waRelay.create({
    data: { towerId, kind, params: JSON.stringify(params) },
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(700);
    const r = await prisma.waRelay.findUnique({ where: { id: row.id } });
    if (r?.status === "done") return { ok: true, result: r.result ? JSON.parse(r.result) : null };
    if (r?.status === "error") return { ok: false, error: r.error ?? "فشل التنفيذ على الوكيل" };
  }
  // نظّف الطلب المعلّق حتى لا يُنفَّذ متأخّراً
  await prisma.waRelay.update({ where: { id: row.id }, data: { status: "error", error: "timeout" } }).catch(() => {});
  return { ok: false, error: "انتهت المهلة — تأكّد أن وكيل المكتب متصل" };
}

// (على الوكيل) نفّذ طلبات المُرحِّل المعلّقة: القائد فقط.
export function startWaRelayPoller() {
  const gg = globalThis as unknown as { __waRelayPollerStarted?: boolean };
  if (gg.__waRelayPollerStarted) return;
  gg.__waRelayPollerStarted = true;
  setInterval(async () => {
    try {
      const { isLeaderNow } = await import("@/lib/hybridAgent");
      if (!isLeaderNow()) return;
      const pend = await prisma.waRelay.findMany({
        where: { status: "pending", createdAt: { gte: new Date(Date.now() - 60_000) } },
        orderBy: { id: "asc" },
        take: 5,
      });
      for (const relayRow of pend) {
        try {
          const p = (relayRow.params ? JSON.parse(relayRow.params) : {}) as { chatId?: string; text?: string; limit?: number };
          // تأكّد أن واتساب المكتب جاهز فعلاً قبل محاولة جلب المحادثات
          const st = store(relayRow.towerId);
          if ((relayRow.kind === "chats" || relayRow.kind === "messages" || relayRow.kind === "send") && st.state !== "ready") {
            throw new Error(`واتساب المكتب غير جاهز (الحالة: ${st.state})`);
          }
          let result: unknown = null;
          if (relayRow.kind === "chats") result = await getOfficeChats(relayRow.towerId, p.limit ?? 40);
          else if (relayRow.kind === "messages") result = await getOfficeMessages(relayRow.towerId, p.chatId ?? "", p.limit ?? 40);
          else if (relayRow.kind === "send") result = await sendOfficeChat(relayRow.towerId, p.chatId ?? "", p.text ?? "");
          else if (relayRow.kind === "logout") { await logoutWhatsApp(relayRow.towerId); result = { ok: true }; }
          await prisma.waRelay.update({ where: { id: relayRow.id }, data: { status: "done", result: JSON.stringify(result) } });
        } catch (e) {
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          console.error(`[wa-relay] فشل ${relayRow.kind} مكتب ${relayRow.towerId}:`, e instanceof Error ? e.stack : e);
          await prisma.waRelay.update({ where: { id: relayRow.id }, data: { status: "error", error: msg.slice(0, 500) } }).catch(() => {});
        }
      }
      // تنظيف الطلبات القديمة (منجزة أو فاشلة) الأقدم من 5 دقائق
      await prisma.waRelay.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 5 * 60_000) } } }).catch(() => {});
    } catch { /* تجاهل */ }
  }, 2000);
}
