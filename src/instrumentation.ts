// يُستدعى مرة عند إقلاع خادم Next.js — نبدأ منه المجدول والواتساب (العامل).
// العامل (المجدول + الواتساب + المزامنة) يعمل فقط حيث RUN_WORKER=1 (حواسيب المكاتب المحلية).
// على Vercel (استضافة الويب) لا يُضبط المتغيّر فلا يعمل العامل — لأنها لا تشغّل متصفّح Chromium.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_WORKER === "1") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
