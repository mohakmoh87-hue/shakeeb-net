import http from "node:http";
import { prisma } from "@/lib/prisma";
import { proxyToSas } from "@/lib/sasProxy";
import { sasBaseUrl, sasLogin, sasFetchOnePage, sasFetchAllUsers, sasFetchOnlineCount, parseUsersList, type SasUser } from "@/lib/sas4";
import { getWorkerAgentId } from "@/lib/hybridAgent";

// خادم محلي على حاسبة المكتب (المنفذ 47615): يخدم فحص الصحّة + لوحة SAS + عمليات SAS
// مباشرةً من الحاسبة القريبة من خادم SAS — فأسرع بكثير من المرور بـVercel (فرانكفورت).
// المتصفّح (على حاسبة المكتب) يتصل بـ http://127.0.0.1:47615 (localhost = سياق آمن، لا يُحجب).
const PORT = 47615;

// توكن SAS لكل مكتب (يُخزَّن دقائق لتفادي إعادة الدخول عند كل أصل من اللوحة)
const tokenCache = new Map<number, { token: string; at: number }>();
const TOKEN_TTL = 4 * 60 * 1000;
// آخر قائمة مشتركين عُرضت في اللوحة لكل مكتب (لاستيراد المعروض)
const viewCache = new Map<number, { users: SasUser[]; at: number }>();
// المكتب/المضيف للّوحة المفتوحة حالياً — تستعمله نداءات اللوحة على /admin/* (بديل الكوكيز)
let currentPanel: { towerId: number; host: string } | null = null;

function cors(res: http.ServerResponse, origin?: string) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
}
function sendJson(res: http.ServerResponse, status: number, obj: unknown) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); req.on("error", () => resolve(""));
  });
}

// مكتب يتبع وكيل هذه الحاسبة فقط (عزل)
async function agentTower(towerId: number) {
  const aid = getWorkerAgentId();
  if (aid == null) return null;
  const t = await prisma.tower.findUnique({
    where: { id: towerId },
    select: { id: true, agentId: true, loginUrl: true, username: true, password: true },
  });
  return t && t.agentId === aid && t.loginUrl && t.username && t.password ? t : null;
}
async function towerToken(t: { id: number; loginUrl: string | null; username: string | null; password: string | null }): Promise<string> {
  const c = tokenCache.get(t.id);
  if (c && Date.now() - c.at < TOKEN_TTL) return c.token;
  const token = await sasLogin(sasBaseUrl(t.loginUrl!), t.username!, t.password!);
  tokenCache.set(t.id, { token, at: Date.now() });
  return token;
}

// ===== عدّاد المشتركين (أ5): فعالين/كلي محلياً بالكامل — يقرأ من SAS المكتب فقط =====
// شرط محمد: التحديث كل 5 ثوانٍ يجب ألا يمرّ على Azure/Aiven إطلاقاً لتقليل الاستهلاك.
// لذا بيانات المكتب (الرابط/اليوزر/الباسورد) تُقرأ من القاعدة مرة واحدة لعمر العملية
// وتُخزَّن بالذاكرة، والأرقام تأتي من مسح مخزون SAS المخزّن مؤقتاً (تجديد كل 45 ثانية).
type TowerCreds = { id: number; loginUrl: string; username: string; password: string };
const credsCache = new Map<number, { t: TowerCreds | null; at: number }>();
const CREDS_NEG_TTL = 5 * 60 * 1000; // مكتب غير تابع/ناقص: أعد المحاولة بعد 5 دقائق
async function agentTowerCached(towerId: number): Promise<TowerCreds | null> {
  const c = credsCache.get(towerId);
  if (c && (c.t || Date.now() - c.at < CREDS_NEG_TTL)) return c.t;
  const t = await agentTower(towerId); // مرور وحيد على القاعدة، ثم ذاكرة لعمر العملية
  const v = t ? { id: t.id, loginUrl: t.loginUrl!, username: t.username!, password: t.password! } : null;
  credsCache.set(towerId, { t: v, at: Date.now() });
  return v;
}

const statsCache = new Map<number, { active: number; total: number; at: number }>();
const statsInflight = new Map<number, Promise<void>>();
const STATS_TTL = 45_000; // مسح SAS كل 45 ثانية كحد أقصى (المتصفّح يستطلع كل 5 ثوانٍ من الكاش)
// «المتصلين الآن»: طلب واحد خفيف (count=1) يتجدّد مع كل استطلاع (كل 5 ثوانٍ) — شبكة المكتب المحلية
const onlineCache = new Map<number, { online: number | null; at: number }>();
const ONLINE_TTL = 4_500;

async function refreshTowerStats(t: TowerCreds): Promise<void> {
  const base = sasBaseUrl(t.loginUrl);
  const token = await towerToken(t);
  const users = await sasFetchAllUsers(base, token, 500, 700, 30);
  const now = Date.now();
  let active = 0;
  // «فعال» = مُمكَّن في SAS وتاريخ انتهائه بالمستقبل (نفس مفهوم «حالة الخدمة: فعالة»)
  for (const u of users) {
    if (u.enabled && u.expiration && new Date(u.expiration).getTime() > now) active++;
  }
  statsCache.set(t.id, { active, total: users.length, at: now });
}

// تحويل طلب Node إلى Request ويب (لإعادة استخدام proxyToSas)
function toWebRequest(req: http.IncomingMessage, bodyBuf: Buffer | undefined): Request {
  const url = `http://127.0.0.1:${PORT}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  return new Request(url, { method: req.method, headers, body: bodyBuf && bodyBuf.length ? new Uint8Array(bodyBuf) : undefined });
}

async function pushStatsToCloud(): Promise<void> {
  const aid = getWorkerAgentId();
  if (aid == null) { console.log("[stats-push] بلا وكيل بعد — تأجيل الرفعة"); return; }
  const towers = await prisma.tower.findMany({
    where: { agentId: aid, isDeleted: false, loginUrl: { not: null }, username: { not: null }, password: { not: null } },
    select: { id: true },
  });
  const offices: Record<string, { active: number; total: number; online: number | null }> = {};
  // تشخيص لكل مكتب فشل — يُكتب مع الرفعة كي يُعرف السبب من القاعدة عن بُعد
  const diag: Record<string, string> = {};
  for (const t of towers) {
    try {
      const creds = await agentTowerCached(t.id);
      if (!creds) { diag[t.id] = "بيانات SAS ناقصة أو المكتب غير تابع"; continue; }
      let sc = statsCache.get(t.id);
      if (!sc || Date.now() - sc.at > STATS_TTL) {
        try { await refreshTowerStats(creds); sc = statsCache.get(t.id); }
        catch (e) { diag[t.id] = `تعذّر مسح SAS: ${e instanceof Error ? e.message : String(e)}`; }
      }
      let oc = onlineCache.get(t.id);
      if (!oc || Date.now() - oc.at > 60_000) {
        try {
          const token = await towerToken(creds);
          oc = { online: await sasFetchOnlineCount(sasBaseUrl(creds.loginUrl), token), at: Date.now() };
          onlineCache.set(t.id, oc);
        } catch { /* «المتصلين» اختياري — لا يُفشل الرفعة */ }
      }
      if (sc) offices[t.id] = { active: sc.active, total: sc.total, online: oc?.online ?? null };
      else if (!diag[t.id]) diag[t.id] = "لا مخزون إحصاء بعد";
    } catch (e) { diag[t.id] = e instanceof Error ? e.message : String(e); }
  }
  // الرفعة تُكتب دائماً (حتى بلا مكاتب) — وجود السطر بحد ذاته يثبت أن كود الرفع
  // يعمل على الحاسبة، وdiag يشرح أي فشل. وتُدمج مع مكاتب الحاسبات الأخرى: كل حاسبة
  // مكتبٍ ترى SAS مكتبها فقط، فالكتابة الساحقة كانت ستمحو أرقام المكتب الآخر بالتناوب.
  const type = `subStats:${aid}`;
  const row = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true, text: true } });
  let prev: { offices?: Record<string, unknown>; diag?: Record<string, string> } = {};
  try { prev = row?.text ? JSON.parse(row.text) : {}; } catch { /* نص فاسد — نبدأ نظيفاً */ }
  const mergedOffices = { ...(prev.offices ?? {}), ...offices };
  const mergedDiag: Record<string, string> = { ...(prev.diag ?? {}), ...diag };
  for (const id of Object.keys(mergedOffices)) delete mergedDiag[id]; // مكتب له أرقام لا يحتاج تشخيصاً
  const text = JSON.stringify({
    at: new Date().toISOString(),
    offices: mergedOffices,
    ...(Object.keys(mergedDiag).length ? { diag: mergedDiag } : {}),
  });
  if (row) await prisma.systemSetting.update({ where: { id: row.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
  console.log(`[stats-push] ✓ رُفعت أرقام ${Object.keys(offices).length} مكتب` +
    (Object.keys(diag).length ? ` — إخفاقات: ${JSON.stringify(diag)}` : ""));
}

export function startLocalSasServer() {
  const g = globalThis as unknown as { __localSasStarted?: boolean };
  if (g.__localSasStarted) return;
  g.__localSasStarted = true;

  // رفع الخلاصة للقاعدة كل 5 دقائق (وأول رفعة بعد 45 ثانية من الإقلاع) —
  // فشل الرفعة يُطبع في نافذة العامل (كان يُبلع صامتاً فتعذّر التشخيص) —
  // ليراها محمد من أي مكان (قراءة كل 5 دقائق)؛ حمل الخطة المجانية: سطر upsert لا غير
  const pushLogged = () => pushStatsToCloud().catch((e) => console.error("[stats-push] ✗ فشلت الرفعة:", e instanceof Error ? e.message : e));
  setTimeout(() => { void pushLogged(); }, 45_000);
  setInterval(() => { void pushLogged(); }, 5 * 60 * 1000);

  const server = http.createServer(async (req, res) => {
    cors(res, req.headers.origin as string | undefined);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const p = url.pathname;
    try {
      // فحص الصحّة + معرّف الوكيل
      if (p.startsWith("/health")) { sendJson(res, 200, { ok: true, agent: "shakeeb-net", agentId: getWorkerAgentId() }); return; }

      // بروكسي لوحة SAS: /sas/:towerId/...  (يحقن التوكن في HTML للدخول التلقائي، ويلتقط قوائم العرض)
      const panel = p.match(/^\/sas\/(\d+)\/?(.*)$/);
      if (panel) {
        const towerId = Number(panel[1]);
        const t = await agentTower(towerId);
        if (!t) { res.writeHead(404); res.end("tower not allowed"); return; }
        const host = (t.loginUrl || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
        currentPanel = { towerId, host }; // تُستعمل في نداءات /admin/*
        const bodyBuf = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.from(await readBody(req));
        const webReq = toWebRequest(req, bodyBuf);
        let capturedJson: string | null = null;
        const webRes = await proxyToSas(webReq, host, panel[2] || "", `/sas/${towerId}/`, (txt) => { capturedJson = txt; });
        // التقاط قائمة المشتركين المعروضة
        if (capturedJson) { try { const us = parseUsersList(capturedJson); if (us.length) viewCache.set(towerId, { users: us, at: Date.now() }); } catch { /* */ } }
        const ct = webRes.headers.get("content-type") || "";
        let bodyText: Buffer;
        if (ct.includes("text/html")) {
          // حقن التوكن في localStorage قبل تحميل سكربتات اللوحة (دخول تلقائي)
          const token = await towerToken(t).catch(() => "");
          const apiUrl = `/admin/api/index.php/api/`; // اللوحة تنادي API على /admin/* (جذر)
          let html = await webRes.text();
          const inject = `<script>try{localStorage.setItem('sas4_jwt',${JSON.stringify(token)});localStorage.setItem('sas4_api_url',${JSON.stringify(apiUrl)});}catch(e){}</script>`;
          html = html.replace(/<head[^>]*>/i, (m) => m + inject);
          bodyText = Buffer.from(html);
        } else {
          bodyText = Buffer.from(await webRes.arrayBuffer());
        }
        res.setHeader("Content-Type", ct);
        res.writeHead(webRes.status);
        res.end(bodyText);
        return;
      }

      // بروكسي نداءات API للّوحة: /admin/*  (تُوجَّه لخادم SAS للمكتب المفتوح حالياً)
      if (p.startsWith("/admin/") || p === "/admin") {
        if (!currentPanel) { res.writeHead(404); res.end("no panel"); return; }
        const bodyBuf = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.from(await readBody(req));
        const webReq = toWebRequest(req, bodyBuf);
        const upstreamPath = p.replace(/^\//, ""); // admin/...
        let capturedJson: string | null = null;
        const webRes = await proxyToSas(webReq, currentPanel.host, upstreamPath, undefined, (txt) => { capturedJson = txt; });
        if (capturedJson && upstreamPath.endsWith("index/user")) {
          try { const us = parseUsersList(capturedJson); if (us.length) viewCache.set(currentPanel.towerId, { users: us, at: Date.now() }); } catch { /* */ }
        }
        const ct = webRes.headers.get("content-type") || "";
        res.setHeader("Content-Type", ct);
        res.writeHead(webRes.status);
        res.end(Buffer.from(await webRes.arrayBuffer()));
        return;
      }

      // عدّاد المشتركين (أ5): مجموع فعالين/كلي لمكاتب محدّدة — من كاش مسح SAS المحلي.
      // ?towers=1,2,3 — يتجاهل أي مكتب لا يتبع وكيل هذه الحاسبة (عزل).
      if (p === "/stats/subscribers" && req.method === "GET") {
        const ids = (url.searchParams.get("towers") || "")
          .split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
        if (!ids.length) { sendJson(res, 400, { error: "towers مطلوب" }); return; }
        let active = 0, total = 0, oldest = Date.now(), any = false;
        let online = 0, onlineKnown = false;
        for (const id of ids) {
          const t = await agentTowerCached(id);
          if (!t) continue;
          const cached = statsCache.get(id);
          if (!cached || Date.now() - cached.at > STATS_TTL) {
            if (!statsInflight.has(id)) {
              statsInflight.set(id, refreshTowerStats(t)
                .catch(() => { tokenCache.delete(id); credsCache.delete(id); }) // توكن/بيانات فاسدة: تُجدَّد بالمحاولة التالية
                .finally(() => statsInflight.delete(id)));
            }
            // أول طلب للمكتب: ننتظر المسح؛ وبعدها نخدم من الكاش والتجديد بالخلفية
            if (!cached) { try { await statsInflight.get(id); } catch { /* */ } }
          }
          const s = statsCache.get(id);
          if (s) { active += s.active; total += s.total; oldest = Math.min(oldest, s.at); any = true; }
          // المتصلون الآن — طلب خفيف يتجدّد كل استطلاع تقريباً
          let oc = onlineCache.get(id);
          if (!oc || Date.now() - oc.at > ONLINE_TTL) {
            try {
              const token = await towerToken(t);
              oc = { online: await sasFetchOnlineCount(sasBaseUrl(t.loginUrl), token), at: Date.now() };
            } catch { oc = { online: oc?.online ?? null, at: Date.now() }; }
            onlineCache.set(id, oc);
          }
          if (oc.online != null) { online += oc.online; onlineKnown = true; }
        }
        if (!any) { sendJson(res, 404, { error: "لا مكاتب صالحة" }); return; }
        sendJson(res, 200, { active, total, online: onlineKnown ? online : null, at: oldest });
        return;
      }

      // ===== عمليات البيانات (JSON) =====
      if (p === "/sas4/token" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        const t = await agentTower(Number(b.towerId));
        if (!t) { sendJson(res, 400, { error: "المكتب لا يتبع حسابك" }); return; }
        const token = await towerToken(t);
        sendJson(res, 200, { token, apiUrl: `/sas/${t.id}/admin/api/index.php/api/` });
        return;
      }
      if (p === "/sas4/fetch" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        const t = await agentTower(Number(b.towerId));
        if (!t) { sendJson(res, 400, { error: "المكتب لا يتبع حسابك" }); return; }
        const base = sasBaseUrl(t.loginUrl!);
        const token = await towerToken(t);
        const { users, total, lastPage } = await sasFetchOnePage(base, token, Number(b.page) || 1, Number(b.count) || 50);
        const existing = await prisma.subscriber.findMany({ where: { sasId: { in: users.map((u) => u.sasId) } }, select: { sasId: true } });
        const ex = new Set(existing.map((e) => e.sasId));
        sendJson(res, 200, { total, lastPage, page: Number(b.page) || 1, count: Number(b.count) || 50, users: users.map((u) => ({ ...u, alreadyImported: ex.has(u.sasId) })) });
        return;
      }
      if (p === "/sas4/last-view" && req.method === "GET") {
        const towerId = Number(url.searchParams.get("towerId"));
        const v = viewCache.get(towerId);
        if (!v || !v.users.length) { sendJson(res, 400, { error: "لم تُعرض أي صفحة في اللوحة بعد. تصفّح المشتركين في اللوحة ثم أعد المحاولة." }); return; }
        // 🔴 نفسُ علّة الخادم (بلاغُ محمد 2026-08-13) **وأوسع**: كان بلا `isDeleted` وبلا
        // `towerId` ⇒ (١) المحذوفُ ناعماً يُعَدُّ «مستورداً» فتُقفَل شاشةُ الاستيراد عليه،
        // و(٢) `sasId` يُطابَق في **كلّ مكاتب كلّ الوكلاء** — قراءةٌ عابرةٌ للعزل تقفل
        // استيرادَ مشتركك بمشترك وكيلٍ آخر. **والمحذوفُ ليس مستورداً — هو محذوف.**
        const existing = await prisma.subscriber.findMany({ where: { sasId: { in: v.users.map((u) => u.sasId) }, towerId, isDeleted: false }, select: { sasId: true } });
        const ex = new Set(existing.map((e) => e.sasId));
        sendJson(res, 200, { towerId, users: v.users.map((u) => ({ ...u, alreadyImported: ex.has(u.sasId) })) });
        return;
      }
      if (p === "/sas4/sync" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        const t = await agentTower(Number(b.towerId));
        if (!t) { sendJson(res, 400, { error: "المكتب لا يتبع حسابك" }); return; }
        const { runOfficeSyncAll } = await import("@/lib/subscriptionSync");
        sendJson(res, 200, await runOfficeSyncAll(t.id, { notify: false }));
        return;
      }

      res.writeHead(404); res.end("not found");
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EADDRINUSE") console.error("[local-sas]", e.message);
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[local-sas] خادم SAS المحلي يعمل على http://127.0.0.1:${PORT}`);
  });
}
