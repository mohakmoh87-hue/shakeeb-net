"use client";

import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type Plat = "" | "installed" | "android" | "ios" | "desktop";

// رابط تحميل تطبيق أندرويد الأصلي (APK) — يُخدَم من نفس الموقع.
const APK_URL = "/shakeeb-net.apk";

// زر تثبيت التطبيق بصفحة الدخول — يكتشف الجهاز ويعرض المسار المناسب.
export default function InstallApp() {
  const [plat, setPlat] = useState<Plat>("");
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [modal, setModal] = useState<"ios" | "qr" | "hint" | "android" | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    // داخل التطبيق الأصلي (Capacitor) لا نعرض دعوة التثبيت إطلاقاً
    const inNativeApp = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    if (standalone || inNativeApp) { setPlat("installed"); return; }
    const ua = navigator.userAgent || "";
    const isIos = /iphone|ipad|ipod/i.test(ua) || (/(macintosh)/i.test(ua) && "ontouchend" in document);
    const isAndroid = /android/i.test(ua);
    setPlat(isIos ? "ios" : isAndroid ? "android" : "desktop");

    const win = window as unknown as { __bipEvent?: BIPEvent | null };
    // الحدث المُلتقَط مبكّراً (قبل تحميل React) — لا نفوّته
    if (win.__bipEvent) setDeferred(win.__bipEvent);
    const onReady = () => { if (win.__bipEvent) setDeferred(win.__bipEvent); };
    const onBip = (e: Event) => { e.preventDefault(); win.__bipEvent = e as BIPEvent; setDeferred(e as BIPEvent); };
    window.addEventListener("bip-ready", onReady);
    window.addEventListener("beforeinstallprompt", onBip);
    const onInstalled = () => { win.__bipEvent = null; setPlat("installed"); };
    window.addEventListener("appinstalled", onInstalled);

    // كشف إن كان التطبيق مثبّتاً مسبقاً (كروم) — فنعرض «افتحه» بدل إعادة التثبيت
    (navigator as unknown as { getInstalledRelatedApps?: () => Promise<unknown[]> }).getInstalledRelatedApps?.()
      .then((apps) => { if (Array.isArray(apps) && apps.length > 0) setPlat("installed"); }).catch(() => {});

    return () => { window.removeEventListener("bip-ready", onReady); window.removeEventListener("beforeinstallprompt", onBip); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (plat === "" || plat === "installed") return null;

  async function onClick() {
    if (plat === "android") { setModal("android"); return; } // تطبيق أندرويد الأصلي (APK)
    if (deferred) { await deferred.prompt(); const c = await deferred.userChoice.catch(() => null); if (c?.outcome === "accepted") setPlat("installed"); setDeferred(null); return; }
    if (plat === "ios") setModal("ios");
    else if (plat === "desktop") setModal("qr");
    else setModal("hint");
  }

  const label = plat === "ios" ? "📲 تثبيت على آيفون" : plat === "desktop" ? "🖥️ فتح على الهاتف" : "⬇️ تحميل تطبيق أندرويد";
  const desc = plat === "android"
    ? "التطبيق الأصلي — تتبّع الموقع بالطلب حتى والتطبيق مُغلَق، وإشعارات فورية"
    : "ثبّته على هاتفك ليعمل كتطبيق مستقلّ بإشعارات فورية";

  return (
    <>
      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-mynet-blue/20 bg-white/70 p-3 shadow-sm">
        {/* أيقونة التطبيق */}
        <img src="/icons/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl shadow" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-800">تطبيق إدارة الفنيين</div>
          <div className="text-[11px] text-slate-500">{desc}</div>
        </div>
        <button onClick={onClick} className="shrink-0 rounded-xl bg-mynet-blue px-3 py-2 text-sm font-bold text-white hover:bg-mynet-blue-dark">{label}</button>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setModal(null)} className="mb-1 ml-auto flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>

            {modal === "android" && (
              <>
                <img src="/icons/icon-192.png" alt="" className="mx-auto mb-2 h-16 w-16 rounded-2xl shadow" />
                <div className="mb-1 text-lg font-bold text-slate-800">تطبيق أندرويد الأصلي</div>
                <div className="mb-3 text-xs text-slate-500">يعمل تتبّع الموقع فيه حتى والتطبيق مُغلَق (عند طلب المكتب فقط).</div>
                <a href={APK_URL} download className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-mynet-blue px-4 py-3 text-base font-bold text-white shadow hover:bg-mynet-blue-dark">⬇️ تحميل التطبيق (APK)</a>
                <ol className="space-y-2 text-right text-sm text-slate-600">
                  <li>1️⃣ اضغط <b>تحميل التطبيق</b> بالأعلى وانتظر انتهاء التنزيل.</li>
                  <li>2️⃣ افتح الملف المُنزَّل (<b>app</b>). إن ظهر تنبيه «مصادر غير معروفة» فاسمح لمتصفّحك بالتثبيت هذه المرّة.</li>
                  <li>3️⃣ اضغط <b>«تثبيت»</b> ثم <b>«فتح»</b>.</li>
                  <li>4️⃣ عند أول فتح: اسمح بالموقع <b>«طوال الوقت»</b> والإشعارات.</li>
                </ol>
                <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">هذا هو التطبيق الرسمي لشكيب نت. لن يستهلك موقعك أو بطاريتك إلا حين يطلب مكتبك التتبّع.</div>
              </>
            )}

            {modal === "ios" && (
              <>
                <div className="mb-2 text-lg font-bold text-slate-800">التثبيت على آيفون</div>
                <ol className="space-y-2 text-right text-sm text-slate-600">
                  <li>1️⃣ افتح الموقع في متصفّح <b>Safari</b>.</li>
                  <li>2️⃣ اضغط زر <b>المشاركة</b> <span dir="ltr">⬆️</span> بالأسفل.</li>
                  <li>3️⃣ اختر <b>«إضافة إلى الشاشة الرئيسية»</b>.</li>
                  <li>4️⃣ اضغط <b>«إضافة»</b> — يظهر التطبيق بأيقونته على الشاشة.</li>
                </ol>
              </>
            )}

            {modal === "qr" && (
              <>
                <div className="mb-3 text-lg font-bold text-slate-800">افتح على هاتفك</div>
                <img src="/icons/qr.png" alt="QR" className="mx-auto h-52 w-52 rounded-xl border border-slate-200" />
                <div className="mt-3 text-xs text-slate-500">امسح الرمز بكاميرا الهاتف لفتح الموقع، ثم ثبّته من هناك.</div>
              </>
            )}

            {modal === "hint" && (
              <>
                <div className="mb-2 text-lg font-bold text-slate-800">تثبيت التطبيق</div>
                <ol className="mb-3 space-y-2 text-right text-sm text-slate-600">
                  <li>1️⃣ افتح الموقع في متصفّح <b>Chrome</b> (لا داخل تطبيق آخر).</li>
                  <li>2️⃣ من قائمة المتصفّح <b>⋮</b> (أعلى اليمين) اختر <b>«تثبيت التطبيق»</b> أو <b>«إضافة إلى الشاشة الرئيسية»</b>.</li>
                </ol>
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">إن كان التطبيق <b>مثبّتاً مسبقاً</b>، فلن يظهر خيار التثبيت — افتحه مباشرةً من <b>أيقونته على الشاشة الرئيسية</b> لهاتفك.</div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
