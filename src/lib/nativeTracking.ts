// تتبع الموقع في الخلفية داخل التطبيق الأصلي (Capacitor) عبر خدمة نظام.
// يعمل والتطبيق مُبعَد للخلفية، ويُطفأ تماماً حين يوقف الخادم الطلب (بلا استهلاك بطارية).
// في المتصفح العادي: كل الدوال تعيد "unsupported" ولا تفعل شيئاً (الموقع لا يتأثر).
// الإضافة الأصلية بلا JS — تُسجَّل عبر registerPlugin، والنوع يُستورَد type-only (يُمحى بالبناء).

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

const BG = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

let watcherId: string | null = null;

// هل نحن داخل التطبيق الأصلي (لا المتصفح)؟
export function isNativeApp(): boolean {
  try {
    return typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export type NativeTrackResult = "ok" | "denied" | "unsupported";

// يبدأ خدمة تتبع الموقع الأصلية (مرّة واحدة). callback يُرسل الموقع للخادم ويعيد
// هل يبقى التتبع مطلوباً؛ إن لا → تُطفأ الخدمة تلقائياً.
export async function startNativeTracking(
  onLocation: (lat: number, lng: number) => Promise<boolean>,
): Promise<NativeTrackResult> {
  if (!isNativeApp()) return "unsupported";
  if (watcherId) return "ok"; // تعمل أصلاً
  return new Promise<NativeTrackResult>((resolve) => {
    let settled = false;
    BG.addWatcher(
      {
        requestPermissions: true,
        stale: false,
        backgroundTitle: "شكيب نت — تتبع الموقع",
        backgroundMessage: "مكتبك يتابع موقعك أثناء الدوام",
        distanceFilter: 15, // تحديث عند تحرّك ~15م
      },
      (location, error) => {
        if (error) {
          if (error.code === "NOT_AUTHORIZED" && !settled) { settled = true; resolve("denied"); }
          return;
        }
        if (!settled) { settled = true; resolve("ok"); }
        if (location) {
          void onLocation(location.latitude, location.longitude)
            .then((keep) => { if (!keep) void stopNativeTracking(); }) // الخادم أوقف الطلب → إطفاء الخدمة
            .catch(() => {});
        }
      },
    ).then((id) => { watcherId = id; }).catch(() => { if (!settled) { settled = true; resolve("denied"); } });
  });
}

// يوقف خدمة التتبع تماماً (لا خدمة، لا بطارية).
export async function stopNativeTracking(): Promise<void> {
  if (!watcherId) return;
  const id = watcherId;
  watcherId = null;
  try {
    await BG.removeWatcher({ id });
  } catch { /* تجاهل */ }
}

// فتح إعدادات التطبيق (لتفعيل إذن الموقع «السماح دائماً» يدوياً إن رُفض)
export async function openNativeSettings(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await BG.openSettings();
  } catch { /* تجاهل */ }
}
