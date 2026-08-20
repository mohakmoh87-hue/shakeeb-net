// يُستدعى مرة عند إقلاع خادم Next.js — نبدأ منه المجدول والواتساب (العامل).
// العامل (المجدول + الواتساب + المزامنة) يعمل فقط حيث RUN_WORKER=1 (حواسيب المكاتب المحلية).
// على Vercel (استضافة الويب) لا يُضبط المتغيّر فلا يعمل العامل — لأنها لا تشغّل متصفّح Chromium.
export async function register() {
  // ب-٢ · ساحبُ طابور البثّ الجماعيّ — **على الموقع السحابيّ حصراً** (حواسيبُ المكاتب لا
  // تسحب: الساحبُ يُرحّل إليها عبر wa_relay أصلاً، وساحبٌ واحدٌ أبسطُ حَجزاً وتشخيصاً).
  // يُستأنف تلقائيّاً بعد أيّ نشرةٍ/إقلاعٍ — وهو ما مات به بثُّ الشدن عند ٤١٦/٢٤٤٧.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_WORKER !== "1") {
    const kick = async (reason: string) => {
      try {
        const { kickBroadcastDrainer } = await import("@/lib/broadcastQueue");
        kickBroadcastDrainer(reason);
      } catch (e) { console.error("[broadcast] تعذّر بدء الساحب:", e instanceof Error ? e.message : e); }
    };
    setTimeout(() => void kick("إقلاع الموقع"), 20_000);
    // دوريّةُ أمانٍ كلَّ ٥ دقائق: صفوفٌ أُعيدت للطابور يدويّاً (أو حُرِّرت من حجزٍ عالق)
    // تُلتقط بلا انتظار بثٍّ جديد — والركلُ رخيصٌ: لا شيءَ في الطابور ⇒ خروجٌ فوريّ.
    setInterval(() => void kick("دوريّة"), 5 * 60_000);

    // ⏰ الكرون الداخليّ (2026-08-20 — بديلُ مهمّة GitHub الليليّة المحذوفة بقرار محمد):
    // بصمةُ الخروج بوقتِ كلِّ فنيّ + الكتلةُ الليليّة + نسخةُ المالك إلى درايف.
    const cronKick = async (reason: string) => {
      try {
        const { kickInternalCron } = await import("@/lib/internalCron");
        kickInternalCron(reason);
      } catch (e) { console.error("[internal-cron] تعذّر البدء:", e instanceof Error ? e.message : e); }
    };
    setTimeout(() => void cronKick("إقلاع الموقع"), 30_000);
    setInterval(() => void cronKick("دوريّة"), 5 * 60_000);
  }
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
