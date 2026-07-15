import http from "node:http";

// منفذ وكيل شكيب نت المحلي (يطابق ما يفحصه HybridOnboarding في المتصفح)
const PORT = 47615;

// خادم صحّة صغير للوكيل المحلي — يسمح لموقع الويب (https) باكتشاف أن هذه الحاسبة
// مُعدّة ضمن النظام الهجين، عبر localhost مع رؤوس Private Network Access + CORS.
export function startAgentHealthServer() {
  const g = globalThis as unknown as { __agentHealthStarted?: boolean };
  if (g.__agentHealthStarted) return;
  g.__agentHealthStarted = true;

  const server = http.createServer((req, res) => {
    const origin = (req.headers.origin as string) || "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Private-Network", "true"); // PNA: يسمح لصفحة https باكتشاف localhost
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.url && req.url.startsWith("/health")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, agent: "shakeeb-net", ts: Date.now() }));
      return;
    }
    res.writeHead(404); res.end();
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    // EADDRINUSE = الوكيل يعمل مسبقاً على هذه الحاسبة؛ نتجاهل بهدوء
    if (e.code !== "EADDRINUSE") console.error("[agent-health]", e.message);
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[agent-health] وكيل شكيب نت يستمع على http://127.0.0.1:${PORT}/health`);
  });
}
