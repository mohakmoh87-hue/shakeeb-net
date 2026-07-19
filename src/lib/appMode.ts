// «وضع التطبيق»: صحيحٌ في PWA المثبّت (standalone) أو في التطبيق الأصلي (Capacitor WebView).
// يوحّد الكشف في مكان واحد — لأن التطبيق الأصلي لا يُبلّغ عن display-mode: standalone.
export function isAppMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}
