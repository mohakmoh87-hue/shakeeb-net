// يُستدعى مرة عند إقلاع خادم Next.js — نبدأ منه المجدول والواتساب (العامل).
// العامل (المجدول + الواتساب + المزامنة) يعمل فقط حيث RUN_WORKER=1 (حواسيب المكاتب المحلية).
// على Vercel (استضافة الويب) لا يُضبط المتغيّر فلا يعمل العامل — لأنها لا تشغّل متصفّح Chromium.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_WORKER === "1") {
    // ═════ ب-١/الأصل ٣ · القفلُ **أوّلاً** (2026-08-13) ═════
    // كان المُجدولُ يبدأ في السطر الأوّل — أي **قبل** حجز المنفذ. فلو كان عاملُ `worker.ts`
    // يعمل على الحاسبة نفسِها (وهو الحالُ في كلّ مكتب) لصار على الحاسبة **مُجدولان**:
    // تذكيرُ المشتركين ونسخةُ القاعدة ومزامنةُ SAS **مرّتَين**.
    // وسلوكُ الخاسر هنا `yield` لا `exit`: هذه العمليّةُ تخدم صفحاتِ الموقع، فقتلُها
    // يُسقط الموقعَ المحليَّ كلَّه — يكفي أن تتنازل عن الوظائف الخلفيّة وحدَها.
    // خادم SAS المحلي الكامل (منفذ 47615): الصحّة + بروكسي اللوحة + عمليات SAS.
    // (كان هنا خادم الصحّة القديم فقط — فكان «يخطف» عرض SAS إلى منفذ بلا مسارات /sas)
    const { startLocalSasServer } = await import("@/lib/localSasServer");
    if (!(await startLocalSasServer("yield"))) return; // عاملٌ آخرُ يملك الحاسبة ⇒ لا وظائفَ خلفيّة
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
    // نبضة النظام الهجين — تسجّل الحاسبة وتحسم القيادة (مضيف واتساب)
    const { startHybridAgent } = await import("@/lib/hybridAgent");
    startHybridAgent();
    // مستطلِع طلبات ربط الواتساب القادمة من الموقع (ينشر الـQR للسحابة)
    const { startWaRequestPoller } = await import("@/lib/whatsapp");
    startWaRequestPoller();
  }
}
