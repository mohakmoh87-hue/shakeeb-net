"use client";
import { useEffect, useRef } from "react";

// ===== إيقاف الاستطلاع عند الإخفاء أو الخمول (خفض تكلفة الاستضافة) =====
// المشكلة: كل مستطلِع (setInterval) يُرسِل طلباً للخادم كل بضع ثوانٍ ما دام مركّباً،
// حتى لو تُرك التبويب مفتوحاً بلا استعمال — فيبقى التطبيق «مستيقظاً» على أزور بلا داعٍ.
// الحل بطبقتين:
//   ١) حارس الإخفاء: لا طلب إن كان التبويب مخفيّاً (خلفيّة/تصغير/قفل شاشة).
//   ٢) حارس الخمول: لا طلب إن مرّت IDLE_MS بلا أيّ تفاعل (فأرة/مفاتيح/لمس/تمرير) —
//      ولو كانت الصفحة أمام العين. أوّل تفاعل (أو عودة التبويب للظهور) يستأنف فوراً
//      مع جلبٍ فوريّ لتحديث البيانات.
// النتيجة: تبويبٌ متروك ⇒ لا طلبات ⇒ ينام التطبيق ⇒ $0. والموظّف الفعّال لا يتأثّر.

const IDLE_MS = 3 * 60 * 1000; // ٣ دقائق بلا تفاعل = خامل

// حالة نشاطٍ عالميّة مشتركة: مستمعٌ واحد لكامل الصفحة بدل واحدٍ لكل مستطلِع
let lastActivity = 0;
const wakeListeners = new Set<() => void>();
let installed = false;

const now = () => Date.now();

function fireWake() {
  for (const f of wakeListeners) {
    try { f(); } catch { /* لا يُفشِل مستمعٌ بقيّةَ المستمعين */ }
  }
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  lastActivity = now();
  // أوّل تفاعلٍ بعد الخمول يوقظ كل المستطلِعات فوراً
  const mark = () => {
    const wasIdle = now() - lastActivity > IDLE_MS;
    lastActivity = now();
    if (wasIdle) fireWake();
  };
  for (const ev of ["pointerdown", "keydown", "mousemove", "wheel", "touchstart", "scroll"]) {
    window.addEventListener(ev, mark, { passive: true });
  }
  // عودة التبويب للظهور = نشاطٌ + استئنافٌ فوريّ (كنمط تحديث المال عند التركيز)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      lastActivity = now();
      fireWake();
    }
  });
}

/** هل الصفحة نشِطة الآن؟ (مرئيّة + غير خاملة إن كان الخمول مُفعّلاً) */
function pageActive(pauseWhenIdle: boolean) {
  if (typeof document === "undefined") return false;
  if (document.visibilityState !== "visible") return false;
  if (pauseWhenIdle && now() - lastActivity > IDLE_MS) return false;
  return true;
}

/** هل الصفحة نشِطة (مرئيّة + غير خاملة)؟ لمستطلِعٍ يدويّ خارج الخطّاف (setInterval إجرائيّ). */
export function isPageActive(): boolean {
  install();
  return pageActive(true);
}

/**
 * بديلٌ مباشر لنمط `useEffect(() => { fn(); const t = setInterval(fn, ms); return () => clearInterval(t); })`
 * لكن `fn` لا تُستدعى إلا والصفحة نشِطة (مرئيّة وغير خاملة).
 *
 * @param fn        دالّة الجلب/الاستطلاع (تُستدعى كل intervalMs عند النشاط، ومرّة عند العودة من خمول/إخفاء).
 * @param intervalMs الفاصل بالمللي ثانية.
 * @param opts.enabled      شغّل المستطلِع من عدمه (للشروط، مثل «نافذة مفتوحة»). افتراضي true.
 * @param opts.pauseWhenIdle أوقِف عند الخمول أيضاً لا الإخفاء فقط. افتراضي true.
 * @param opts.runOnMount   نفّذ fn فوراً عند التركيب (كالجلب الأوّل). افتراضي true.
 */
export function usePolling(
  fn: () => void,
  intervalMs: number,
  opts?: { enabled?: boolean; pauseWhenIdle?: boolean; runOnMount?: boolean },
) {
  const enabled = opts?.enabled ?? true;
  const pauseWhenIdle = opts?.pauseWhenIdle ?? true;
  const runOnMount = opts?.runOnMount ?? true;

  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    install();

    if (runOnMount && pageActive(pauseWhenIdle)) fnRef.current();

    const timer = setInterval(() => {
      if (pageActive(pauseWhenIdle)) fnRef.current();
    }, intervalMs);

    // استئنافٌ فوريّ عند العودة (أوّل تفاعل بعد خمول، أو ظهور التبويب)
    const onWake = () => { if (pageActive(pauseWhenIdle)) fnRef.current(); };
    wakeListeners.add(onWake);

    return () => {
      clearInterval(timer);
      wakeListeners.delete(onWake);
    };
  }, [enabled, intervalMs, pauseWhenIdle, runOnMount]);
}
