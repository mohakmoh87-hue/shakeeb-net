// ===== عامل شكيب نت المستقل =====
// يشغّل المجدول + واتساب + خادم الصحّة + نبضة النظام الهجين، بلا الاعتماد على مُسجِّل Next.
// يُشغَّل على حاسبة المكتب عبر: npx tsx src/worker.ts
import fs from "node:fs";

// تحميل متغيّرات .env يدوياً (العملية المستقلة لا تحمّلها تلقائياً كما يفعل Next)
try {
  const envFile = fs.readFileSync(".env", "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
} catch {
  console.error("[worker] تعذّر قراءة .env — تأكّد من وجوده في مجلد التطبيق");
}

process.env.RUN_WORKER = "1";

(async () => {
  console.log("[worker] بدء عامل شكيب نت المستقل...");
  try {
    const { startScheduler } = await import("@/lib/scheduler");
    const { startAgentHealthServer } = await import("@/lib/agentHealth");
    const { startHybridAgent } = await import("@/lib/hybridAgent");
    const { startWaRequestPoller } = await import("@/lib/whatsapp");
    startScheduler();
    startAgentHealthServer();
    startHybridAgent();
    startWaRequestPoller();
    console.log("[worker] ✅ العامل يعمل. اتركه مفتوحاً.");
  } catch (e) {
    console.error("[worker] ❌ فشل بدء العامل:", e);
    process.exit(1);
  }
})();

// إبقاء العملية حيّة
setInterval(() => {}, 1 << 30);
