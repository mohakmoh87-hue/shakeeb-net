import http from "node:http";
import { prisma } from "@/lib/prisma";
import { proxyToSas } from "@/lib/sasProxy";
import { sasBaseUrl, sasLogin, sasFetchOnePage, parseUsersList, type SasUser } from "@/lib/sas4";
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

// تحويل طلب Node إلى Request ويب (لإعادة استخدام proxyToSas)
function toWebRequest(req: http.IncomingMessage, bodyBuf: Buffer | undefined): Request {
  const url = `http://127.0.0.1:${PORT}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  return new Request(url, { method: req.method, headers, body: bodyBuf && bodyBuf.length ? new Uint8Array(bodyBuf) : undefined });
}

export function startLocalSasServer() {
  const g = globalThis as unknown as { __localSasStarted?: boolean };
  if (g.__localSasStarted) return;
  g.__localSasStarted = true;

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
          const apiUrl = `/sas/${towerId}/admin/api/index.php/api/`;
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
        const existing = await prisma.subscriber.findMany({ where: { sasId: { in: v.users.map((u) => u.sasId) } }, select: { sasId: true } });
        const ex = new Set(existing.map((e) => e.sasId));
        sendJson(res, 200, { towerId, users: v.users.map((u) => ({ ...u, alreadyImported: ex.has(u.sasId) })) });
        return;
      }
      if (p === "/sas4/sync" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}");
        const t = await agentTower(Number(b.towerId));
        if (!t) { sendJson(res, 400, { error: "المكتب لا يتبع حسابك" }); return; }
        const { runOfficeSync } = await import("@/lib/subscriptionSync");
        sendJson(res, 200, await runOfficeSync(t.id, { notify: false }));
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
