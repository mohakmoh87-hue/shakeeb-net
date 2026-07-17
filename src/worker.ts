// ===== عامل شكيب نت المستقل =====
// يشغّل المجدول + واتساب + خادم الصحّة + نبضة النظام الهجين، بلا الاعتماد على مُسجِّل Next.
// يُشغَّل على حاسبة المكتب عبر: npx tsx src/worker.ts
import fs from "node:fs";
import net from "node:net";
import { execSync } from "node:child_process";

// قتل متصفّحات puppeteer اليتيمة التي تستخدم مجلد جلساتنا (.wwebjs_auth) من تشغيل سابق
// انهار دون إغلاق نظيف — تمنع خطأ "The browser is already running for ...session-office-X".
// لا يمسّ متصفّح Chrome العادي للمستخدم (نُرشّح بمسار الجلسة فقط).
function killOrphanBrowsers() {
  if (process.platform !== "win32") return;
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*wwebjs_auth*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore", timeout: 20000 },
    );
    console.log("[worker] نُظّفت متصفّحات الواتساب اليتيمة (إن وُجدت)");
  } catch { /* لا شيء ليُقتل أو تعذّر — نتابع */ }
}

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

// حارس النسخة الواحدة: منفذ الوكيل (47615) يعمل قفلاً. إن كان مشغولاً فهناك عامل
// آخر يعمل على هذه الحاسبة — نخرج فوراً لمنع تشغيل متصفّحَي واتساب على نفس الجلسة
// (وإلا يظهر خطأ "The browser is already running for ...session-office-X").
function ensureSingleInstance(): Promise<void> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        console.error("[worker] ⛔ عامل شكيب نت يعمل بالفعل على هذه الحاسبة — تم إيقاف هذه النسخة المكرّرة.");
        process.exit(0);
      }
      resolve(); // خطأ آخر غير متوقّع — نُكمل على أي حال
    });
    probe.listen(47615, "127.0.0.1", () => { probe.close(() => resolve()); });
  });
}

(async () => {
  await ensureSingleInstance();
  killOrphanBrowsers(); // نظّف متصفّحات يتيمة من تشغيل سابق قبل بدء الواتساب
  console.log("[worker] بدء عامل شكيب نت المستقل...");
  try {
    const { startScheduler } = await import("@/lib/scheduler");
    const { startLocalSasServer } = await import("@/lib/localSasServer");
    const { startHybridAgent } = await import("@/lib/hybridAgent");
    const { startWaRequestPoller, startWaRelayPoller } = await import("@/lib/whatsapp");
    startScheduler();
    startLocalSasServer(); // يشمل /health + لوحة SAS + عمليات SAS محلياً (المنفذ 47615)
    startHybridAgent();
    startWaRequestPoller();
    startWaRelayPoller();
    console.log("[worker] ✅ العامل يعمل. اتركه مفتوحاً.");
  } catch (e) {
    console.error("[worker] ❌ فشل بدء العامل:", e);
    process.exit(1);
  }
})();

// إبقاء العملية حيّة
setInterval(() => {}, 1 << 30);
