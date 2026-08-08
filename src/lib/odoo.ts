import { fetch as undiciFetch, Agent } from "undici";

// ===== عميل أودو (SuperCell Helpdesk) — ربط تذاكر أودو بشكيب (طلب محمد 2026-08-08) =====
// يعمل على **عامل حاسبة المكتب المحليّ حصراً** (RUN_WORKER) — عدا اختبار الاتصال (سحابيّ لمرّة).
// الكتابة عبر **مسارات البوّابة الملتقَطة حيّاً** (لا ORM؛ حساب البوّابة can_write:false):
//   • الاستلام:  POST /portal/receive/{id}          body {ticket_id}
//   • حفظ BG:    POST /portal/change_bg_field/{id}   body {ticket_id, bg_field}
//   • الإنجاز:   POST /portal/close/{id}             body {ticket_id}
//   • الإلغاء:   POST /portal/cancel/{id}            body {ticket_id}
//   • الملاحظة:  POST /mail/chatter_post (JSON-RPC)  params {message,res_model,res_id,csrf_token,token}
// القراءة عبر /web/dataset/call_kw (search_read) على helpdesk.ticket.
// التصنيف: تُعالَج فقط التذاكر المُسنَدة لحساب المكتب نفسه (user_id == session.uid) والمفتوحة.

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
const DEFAULT_BASE = "https://odoo.supercell.iq";

export interface OdooSession {
  base: string; // https://odoo.supercell.iq
  cookie: string; // "session_id=...; ..."
  uid: number; // معرّف حساب المكتب (Assigned to المطابق للعمل)
  name: string; // الاسم الظاهر (Omer Raad Fareed)
  username: string;
  csrf: string; // csrf_token للجلسة (لـ chatter وبعض المسارات)
}

// مراحل أودو المفتوحة (تُعالَج) والمنتهية (تُتجاهَل) — بالاسم
const OPEN_STAGES = new Set(["new", "change team", "in progres", "in progress"]);
const DONE_STAGES = new Set(["done", "closed", "cancelled", "canceled"]);
export function isOpenStage(stageName: string | null | undefined): boolean {
  return OPEN_STAGES.has(String(stageName ?? "").trim().toLowerCase());
}
export function isDoneStage(stageName: string | null | undefined): boolean {
  return DONE_STAGES.has(String(stageName ?? "").trim().toLowerCase());
}

// نمط BG (اليوزر): bg-x-x-x@x — كلّ x رقم/حرف. قيمة فارغة أو غير مطابقة ⇒ اليوزر إلزاميّ.
const BG_RE = /^bg-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-?@[a-z0-9]+$/i;
export function bgIsSet(bg: string | null | undefined): boolean {
  const v = String(bg ?? "").trim();
  if (!v || v === "0") return false;
  return BG_RE.test(v);
}
export function bgIsValid(bg: string | null | undefined): boolean {
  return BG_RE.test(String(bg ?? "").trim());
}

export interface OdooTicket {
  id: number;
  name: string; // الوصف
  stageName: string;
  assignedUid: number | null; // user_id الحقيقيّ (للتصنيف)
  createDate: string | null;
  phone: string | null;
  customerName: string | null;
  fdt: string | null;
  fat: string | null;
  bg: string | null; // قيمة BG الحاليّة (فارغة ⇒ إلزاميّ)
  accessToken: string | null; // لـ chatter
  issueType: string | null;
  typeName: string | null;
}

function normBase(u?: string | null): string {
  let b = (u || DEFAULT_BASE).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(b)) b = "https://" + b;
  return b;
}

// دمج Set-Cookie في سلسلة Cookie (session_id يكفي؛ نحتفظ بكلّ المفاتيح)
function mergeCookies(prev: string, setCookies: string[]): string {
  const jar: Record<string, string> = {};
  for (const c of (prev || "").split(";")) {
    const t = c.trim(); if (!t) continue;
    const i = t.indexOf("="); if (i < 0) continue;
    jar[t.slice(0, i)] = t.slice(i + 1);
  }
  for (const sc of setCookies || []) {
    const first = (sc.split(";")[0] || "").trim();
    const i = first.indexOf("="); if (i < 0) continue;
    jar[first.slice(0, i)] = first.slice(i + 1);
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function getSetCookies(res: { headers: { getSetCookie?: () => string[]; get: (n: string) => string | null } }): string[] {
  const h = res.headers;
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const one = h.get("set-cookie");
  return one ? [one] : [];
}

function extractCsrf(html: string): string | null {
  let m = html.match(/csrf_token["']?\s*[:=]\s*["']([0-9A-Za-z._\-]+)["']/);
  if (m) return m[1];
  m = html.match(/name=["']csrf_token["']\s+value=["']([0-9A-Za-z._\-]+)["']/);
  if (m) return m[1];
  return null;
}

// نداء JSON-RPC عامّ (get_session_info / call_kw / chatter_post)
async function rpc(base: string, cookie: string, route: string, params: unknown, extraCsrf?: string): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", cookie };
  if (extraCsrf) headers["X-CSRFToken"] = extraCsrf;
  const res = await undiciFetch(base + route, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: params ?? {} }),
    dispatcher: insecureAgent,
  });
  const text = await res.text();
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(text); } catch { throw new Error(`رد غير JSON من ${route} (HTTP ${res.status})`); }
  if (j?.error) {
    const e = j.error as Record<string, unknown>;
    const data = e?.data as Record<string, unknown> | undefined;
    throw new Error(String(data?.message || e?.message || "خطأ أودو"));
  }
  return (j as Record<string, unknown>)?.result;
}

async function callKw(session: OdooSession, model: string, method: string, args: unknown[], kwargs?: Record<string, unknown>) {
  return rpc(session.base, session.cookie, "/web/dataset/call_kw", { model, method, args, kwargs: kwargs ?? {} });
}

// search_read صامد لأسماء الحقول: يُسقط أيّ حقلٍ غير موجود ويعيد المحاولة (لتفاوت مخطّط أودو بين النسخ)
async function searchReadResilient(
  session: OdooSession, model: string, domain: unknown[], fields: string[], kwargs: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  let f = [...fields];
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const r = await callKw(session, model, "search_read", [domain, f], kwargs);
      return (r as Record<string, unknown>[]) || [];
    } catch (e) {
      const msg = (e as Error).message || "";
      const m = msg.match(/Invalid field '?([a-zA-Z0-9_.]+)'?/) || msg.match(/field '?([a-zA-Z0-9_.]+)'? .*does not exist/i);
      const bad = m?.[1];
      if (bad && f.includes(bad)) { f = f.filter((x) => x !== bad); continue; }
      throw e;
    }
  }
  // فشل مستمرّ: نعيد بالحقول الأساسيّة المضمونة
  const r = await callKw(session, model, "search_read", [domain, ["id", "name", "stage_id"]], kwargs);
  return (r as Record<string, unknown>[]) || [];
}

const m2oLabel = (v: unknown): string | null => (Array.isArray(v) ? String((v as unknown[])[1] ?? (v as unknown[])[0] ?? "") : v === false ? null : v == null ? null : String(v));
const m2oId = (v: unknown): number | null => (Array.isArray(v) ? Number((v as unknown[])[0]) : typeof v === "number" ? v : null);
const strOrNull = (v: unknown): string | null => (v === false || v == null ? null : String(v));

// ===== تسجيل الدخول عبر نموذج البوّابة (لا يحتاج اسم قاعدة — dbfilter الافتراضيّ) =====
export async function odooLogin(baseUrl: string | null, user: string, pass: string): Promise<OdooSession> {
  const base = normBase(baseUrl);
  // 1) GET /web/login → csrf + كوكي أوّليّ
  const g = await undiciFetch(base + "/web/login", { method: "GET", dispatcher: insecureAgent });
  let cookie = mergeCookies("", getSetCookies(g));
  const csrf0 = extractCsrf(await g.text());
  if (!csrf0) throw new Error("تعذّر قراءة csrf من صفحة دخول أودو");
  // 2) POST /web/login (نموذج) — عند النجاح يُعيد التوجيه ويضع session_id مصادَقاً
  const form = new URLSearchParams({ login: user, password: pass, csrf_token: csrf0, redirect: "" });
  const p = await undiciFetch(base + "/web/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: form.toString(),
    redirect: "manual",
    dispatcher: insecureAgent,
  });
  cookie = mergeCookies(cookie, getSetCookies(p));
  // 3) هويّة الجلسة — يؤكّد نجاح الدخول ويعطي uid/الاسم
  const info = (await rpc(base, cookie, "/web/session/get_session_info", {})) as Record<string, unknown> | null;
  const uid = Number(info?.uid ?? 0);
  if (!uid || info?.uid === false) throw new Error("فشل الدخول إلى أودو — تحقّق من اسم المستخدم وكلمة المرور");
  // 4) csrf ما بعد الدخول (للـ chatter وبعض المسارات) — من صفحة /my
  let csrf = csrf0;
  try {
    const my = await undiciFetch(base + "/my", { method: "GET", headers: { cookie }, dispatcher: insecureAgent });
    cookie = mergeCookies(cookie, getSetCookies(my));
    const c = extractCsrf(await my.text());
    if (c) csrf = c;
  } catch { /* غير قاتل */ }
  return {
    base, cookie, uid,
    name: String(info?.name ?? info?.username ?? ""),
    username: String(info?.username ?? user),
    csrf,
  };
}

// ===== سحب تذاكر المكتب المفتوحة الجديدة (المُسنَدة لحسابه، id > العلامة) =====
export async function odooFetchOpenTickets(session: OdooSession, sinceId: number): Promise<OdooTicket[]> {
  // المصدر = user_id == uid المكتب حصراً؛ id > العلامة (تصاعديّ). المرحلة نُصفّيها في الكود.
  const domain: unknown[] = [["user_id", "=", session.uid], ["id", ">", Math.max(0, sinceId | 0)]];
  const fields = [
    "id", "name", "stage_id", "user_id", "create_date",
    "phone", "partner_name", "partner_id",
    "fdt_id", "fat_id", "bg_field", "access_token",
    "issue_type", "type", "task_type",
  ];
  const rows = await searchReadResilient(session, "helpdesk.ticket", domain, fields, { order: "id asc", limit: 200 });
  const out: OdooTicket[] = [];
  for (const r of rows) {
    out.push({
      id: Number(r.id),
      name: String(r.name ?? ""),
      stageName: m2oLabel(r.stage_id) ?? "",
      assignedUid: m2oId(r.user_id),
      createDate: strOrNull(r.create_date),
      phone: strOrNull(r.phone),
      customerName: strOrNull(r.partner_name) ?? m2oLabel(r.partner_id),
      fdt: strOrNull(r.fdt_id) ?? (m2oLabel(r.fdt_id) as string | null),
      fat: strOrNull(r.fat_id) ?? (m2oLabel(r.fat_id) as string | null),
      bg: strOrNull(r.bg_field),
      accessToken: strOrNull(r.access_token),
      issueType: m2oLabel(r.issue_type) ?? strOrNull(r.issue_type),
      typeName: m2oLabel(r.type) ?? strOrNull(r.type) ?? strOrNull(r.task_type),
    });
  }
  return out;
}

// قراءة تذكرة واحدة (لمزامنة حالة بطاقةٍ قائمة: هل أُغلقت خارجيّاً؟)
export async function odooReadTicket(session: OdooSession, ticketId: number): Promise<OdooTicket | null> {
  const rows = await searchReadResilient(session, "helpdesk.ticket", [["id", "=", ticketId]],
    ["id", "name", "stage_id", "user_id", "access_token", "bg_field"], { limit: 1 });
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id), name: String(r.name ?? ""), stageName: m2oLabel(r.stage_id) ?? "",
    assignedUid: m2oId(r.user_id), createDate: null, phone: null, customerName: null,
    fdt: null, fat: null, bg: strOrNull(r.bg_field), accessToken: strOrNull(r.access_token),
    issueType: null, typeName: null,
  };
}

// ===== أفعال الكتابة (مسارات البوّابة الملتقَطة) =====
// المسارات JSON بجسم {ticket_id}؛ نُرسل الكوكي + csrf كترويسة (صامد لو الطريق type=http أو json).
async function portalPost(session: OdooSession, path: string, body: Record<string, unknown>): Promise<void> {
  const res = await undiciFetch(session.base + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", cookie: session.cookie, "X-CSRFToken": session.csrf },
    body: JSON.stringify(body),
    dispatcher: insecureAgent,
  });
  if (!res.ok) {
    const t = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`فشل ${path} (HTTP ${res.status}) ${t}`);
  }
}

export async function odooReceive(session: OdooSession, ticketId: number): Promise<void> {
  await portalPost(session, `/portal/receive/${ticketId}`, { ticket_id: String(ticketId) });
}
export async function odooChangeBg(session: OdooSession, ticketId: number, bg: string): Promise<void> {
  await portalPost(session, `/portal/change_bg_field/${ticketId}`, { ticket_id: ticketId, bg_field: bg });
}
export async function odooClose(session: OdooSession, ticketId: number): Promise<void> {
  await portalPost(session, `/portal/close/${ticketId}`, { ticket_id: String(ticketId) });
}
export async function odooCancel(session: OdooSession, ticketId: number): Promise<void> {
  await portalPost(session, `/portal/cancel/${ticketId}`, { ticket_id: String(ticketId) });
}

// نشر الملاحظة الإجباريّة في محادثة التذكرة (مسار أودو القياسيّ)
export async function odooChatterPost(session: OdooSession, ticketId: number, message: string, accessToken: string | null): Promise<void> {
  const params: Record<string, unknown> = {
    message, res_model: "helpdesk.ticket", res_id: ticketId,
    csrf_token: session.csrf, token: accessToken ?? false,
    attachment_ids: [], attachment_tokens: [],
  };
  await rpc(session.base, session.cookie, "/mail/chatter_post", params, session.csrf);
}

// ===== اختبار الاتصال (سحابيّ، لمرّة، عند الإعداد) — دخولٌ فقط بلا أيّ إجراء =====
export async function odooTestConnection(baseUrl: string | null, user: string, pass: string): Promise<{ ok: boolean; message: string; uid?: number; name?: string }> {
  try {
    const s = await odooLogin(baseUrl, user, pass);
    return { ok: true, message: `الاتصال سليم — الحساب: ${s.name || s.username} (uid ${s.uid})`, uid: s.uid, name: s.name };
  } catch (e) {
    return { ok: false, message: (e as Error).message || "تعذّر الاتصال بأودو" };
  }
}
