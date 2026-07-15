// يُستدعى مرة عند إقلاع خادم Next.js — نبدأ منه المجدول والواتساب (العامل).
// العامل (المجدول + الواتساب + المزامنة) يعمل فقط حيث RUN_WORKER=1 (حواسيب المكاتب المحلية).
// على Vercel (استضافة الويب) لا يُضبط المتغيّر فلا يعمل العامل — لأنها لا تشغّل متصفّح Chromium.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_WORKER === "1") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
    // خادم صحّة الوكيل (منفذ 47615) — يجعل الحاسبة قابلة للكشف من الموقع فيتوقّف إشعار الإعداد
    const { startAgentHealthServer } = await import("@/lib/agentHealth");
    startAgentHealthServer();
    // نبضة النظام الهجين — تسجّل الحاسبة وتحسم القيادة (مضيف واتساب)
    const { startHybridAgent } = await import("@/lib/hybridAgent");
    startHybridAgent();
    // مستطلِع طلبات ربط الواتساب القادمة من الموقع (ينشر الـQR للسحابة)
    const { startWaRequestPoller } = await import("@/lib/whatsapp");
    startWaRequestPoller();
  }
}
