import type { WaChat, WaMessage } from "@/lib/whatsapp";
import type { proto, WAMessage } from "@whiskeysockets/baileys";

// ═════ 🩺 مخزنُ محادثات Baileys في الذاكرة (المرحلة ٣ — طلبُ محمد 2026-11-24) ═════
// Baileys حدثيٌّ لا يملك واجهةَ استعلامٍ مثل whatsapp-web.js، فنلتقط الرسائلَ الواردةَ
// والتاريخَ من أحداثه ونخزّنها لكلّ مكتبٍ في الذاكرة. يكفي للوحة الدردشة (الواردُ
// الحديث + الردّ)؛ يُعاد بناؤه من مزامنة التاريخ عند كلّ اتّصال، فلا يحتاج قاعدةً.

type StoredMsg = { id: string; body: string; fromMe: boolean; timestamp: number; type: string; hasMedia: boolean; raw: WAMessage };
type ChatEntry = { id: string; name: string; isGroup: boolean; timestamp: number; last: string; unread: number; msgs: Map<string, StoredMsg> };
type OfficeChat = { chats: Map<string, ChatEntry>; contacts: Map<string, string> };

const MAX_CHATS = 300;
const MAX_MSGS_PER_CHAT = 200;

const g = globalThis as unknown as { __waBaileysChat?: Map<number, OfficeChat> };
function office(officeId: number): OfficeChat {
  if (!g.__waBaileysChat) g.__waBaileysChat = new Map();
  let o = g.__waBaileysChat.get(officeId);
  if (!o) { o = { chats: new Map(), contacts: new Map() }; g.__waBaileysChat.set(officeId, o); }
  return o;
}

const numTs = (x: number | Long | null | undefined): number => {
  if (x == null) return 0;
  if (typeof x === "number") return x;
  const o = x as unknown as { toNumber?: () => number; low?: number };
  return typeof o.toNumber === "function" ? o.toNumber() : Number(o.low ?? 0);
};
const numOnly = (x: string | null | undefined): string => String(x || "").split(":")[0].split("@")[0];

const KIND_TYPE: Record<string, string> = { text: "chat", image: "image", video: "video", audio: "ptt", document: "document", sticker: "sticker", location: "location", contact: "vcard", other: "chat" };
const PREVIEW: Record<string, string> = { image: "📷 صورة", video: "🎥 فيديو", audio: "🎤 رسالة صوتية", document: "📄 ملف", sticker: "🌟 ملصق", location: "📍 موقع", contact: "👤 جهة اتصال", other: "📎 مرفق", text: "" };
const isMediaKind = (k: string) => k === "image" || k === "video" || k === "audio" || k === "document" || k === "sticker";
const previewText = (kind: string, text: string) => (text && text.trim() ? text : (PREVIEW[kind] ?? ""));

function unwrap(message: proto.IMessage | null | undefined): proto.IMessage | null {
  let m = message as proto.IMessage | null | undefined;
  if (!m) return null;
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m?.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m?.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m?.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
  return m || null;
}

function contentOf(message: proto.IMessage | null | undefined): { kind: string; text: string } | null {
  const m = unwrap(message);
  if (!m) return null;
  if (m.conversation) return { kind: "text", text: m.conversation };
  if (m.extendedTextMessage) return { kind: "text", text: m.extendedTextMessage.text || "" };
  if (m.imageMessage) return { kind: "image", text: m.imageMessage.caption || "" };
  if (m.videoMessage) return { kind: "video", text: m.videoMessage.caption || "" };
  if (m.audioMessage) return { kind: "audio", text: "" };
  if (m.documentMessage) return { kind: "document", text: m.documentMessage.caption || m.documentMessage.fileName || "" };
  if (m.stickerMessage) return { kind: "sticker", text: "" };
  if (m.locationMessage || m.liveLocationMessage) return { kind: "location", text: "" };
  if (m.contactMessage) return { kind: "contact", text: m.contactMessage.displayName || "" };
  if (m.contactsArrayMessage) return { kind: "contact", text: "" };
  if (m.reactionMessage || m.protocolMessage || m.pollUpdateMessage || m.senderKeyDistributionMessage) return null;
  return { kind: "other", text: "" };
}

export function setContact(officeId: number, jid: string | null | undefined, name: string | null | undefined): void {
  if (!jid || !name) return;
  const o = office(officeId);
  o.contacts.set(jid, name);
  const c = o.chats.get(jid);
  if (c && (!c.name || c.name === numOnly(jid))) c.name = name;
}

function prune(o: OfficeChat): void {
  if (o.chats.size <= MAX_CHATS) return;
  const sorted = [...o.chats.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  for (let i = 0; i < sorted.length - MAX_CHATS; i++) o.chats.delete(sorted[i][0]);
}

export function ingest(officeId: number, msg: WAMessage, opts: { historical?: boolean } = {}): void {
  const jid = msg.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;
  const id = msg.key?.id;
  if (!id) return;
  const content = contentOf(msg.message);
  if (!content) return;

  const o = office(officeId);
  const fromMe = !!msg.key?.fromMe;
  const ts = numTs(msg.messageTimestamp);
  const isGroup = jid.endsWith("@g.us");

  let c = o.chats.get(jid);
  if (!c) { c = { id: jid, name: o.contacts.get(jid) || numOnly(jid), isGroup, timestamp: 0, last: "", unread: 0, msgs: new Map() }; o.chats.set(jid, c); }
  if (!isGroup && !fromMe && msg.pushName) { o.contacts.set(jid, msg.pushName); if (!c.name || c.name === numOnly(jid)) c.name = msg.pushName; }

  c.msgs.set(id, { id, body: content.text, fromMe, timestamp: ts, type: KIND_TYPE[content.kind] ?? "chat", hasMedia: isMediaKind(content.kind), raw: msg });
  if (c.msgs.size > MAX_MSGS_PER_CHAT) {
    const oldest = [...c.msgs.values()].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < c.msgs.size - MAX_MSGS_PER_CHAT; i++) c.msgs.delete(oldest[i].id);
  }
  if (ts >= c.timestamp) { c.timestamp = ts; c.last = previewText(content.kind, content.text); }
  if (!opts.historical && !fromMe) c.unread++;
  prune(o);
}

export function chatList(officeId: number, limit = 40): WaChat[] {
  const o = office(officeId);
  const lim = Math.max(1, Math.min(200, Math.floor(limit)));
  return [...o.chats.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, lim)
    .map((c) => ({ id: c.id, name: c.name || numOnly(c.id), unread: c.unread, timestamp: c.timestamp, last: c.last, isGroup: c.isGroup }));
}

export function messageList(officeId: number, chatId: string, limit = 40): WaMessage[] {
  const c = office(officeId).chats.get(chatId);
  if (!c) return [];
  c.unread = 0; // فتحُ المحادثة يُعلّمها مقروءة
  const lim = Math.max(1, Math.min(200, Math.floor(limit)));
  return [...c.msgs.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-lim)
    .map((m) => ({ id: m.id, body: m.body, fromMe: m.fromMe, timestamp: m.timestamp, type: m.type, hasMedia: m.hasMedia }));
}

export function findRaw(officeId: number, msgId: string): WAMessage | null {
  for (const c of office(officeId).chats.values()) {
    const m = c.msgs.get(msgId);
    if (m) return m.raw;
  }
  return null;
}

export function mediaMeta(msg: WAMessage): { mimetype: string; filename: string } {
  const m = unwrap(msg.message);
  const node = m?.imageMessage || m?.videoMessage || m?.audioMessage || m?.documentMessage || m?.stickerMessage;
  return { mimetype: node?.mimetype || "application/octet-stream", filename: m?.documentMessage?.fileName || "" };
}

export function clearOfficeChat(officeId: number): void {
  g.__waBaileysChat?.delete(officeId);
}
