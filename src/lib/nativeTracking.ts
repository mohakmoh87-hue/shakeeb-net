// جسر التطبيق الأصلي (Capacitor) لتتبّع الموقع في الخلفية.
// آلية العمل: المدير يضغط «تتبع» ⇒ الخادم يرسل إشعار FCM ⇒ خدمة أصلية (Java) تبدأ
// وترسل الموقع حتى والتطبيق مُغلَق، وتُطفأ حين يوقف المدير التتبع. لا استهلاك بلا طلب.
// دور الويب هنا: تسجيل رمز جهاز FCM ليتمكّن الخادم من إيقاظنا + فتح الإعدادات عند رفض الإذن.
// في المتصفح العادي: كل الدوال تعيد بهدوء دون أثر (الموقع لا يتأثر).
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

// جسر التتبّع الأصلي (إضافة Java: NativeTrackPlugin)
const NativeTrack = registerPlugin<{
  getToken(): Promise<{ token: string }>;
  startTracking(): Promise<void>;
  stopTracking(): Promise<void>;
}>("NativeTrack");
// إضافة المجتمع — نستعملها فقط لفتح إعدادات التطبيق عند الحاجة
const BG = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

// هل نحن داخل التطبيق الأصلي (لا المتصفح)؟
export function isNativeApp(): boolean {
  try {
    return typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// تسجيل رمز جهاز FCM على الخادم (مرّة عند فتح التطبيق) ليتمكّن من إيقاظ خدمة التتبع.
export async function registerPushToken(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { token } = await NativeTrack.getToken();
    if (!token) return;
    await fetch("/api/field/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  } catch {
    /* تجاهل — لا يؤثر على بقية التطبيق */
  }
}

// تشغيل/إيقاف خدمة الموقع مباشرة حين يكون التطبيق مفتوحاً (احتياط موثوق لا ينتظر الإشعار).
// حين يكون مُغلَقاً، تتكفّل FCM بالإيقاظ. آمنة للاستدعاء المتكرّر (الخدمة تحرس نفسها).
export async function startNativeTracking(): Promise<void> {
  if (!isNativeApp()) return;
  try { await NativeTrack.startTracking(); } catch { /* تجاهل */ }
}
export async function stopNativeTracking(): Promise<void> {
  if (!isNativeApp()) return;
  try { await NativeTrack.stopTracking(); } catch { /* تجاهل */ }
}

// فتح إعدادات التطبيق (لتفعيل إذن الموقع «السماح دائماً» يدوياً إن رُفض)
export async function openNativeSettings(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await BG.openSettings();
  } catch {
    /* تجاهل */
  }
}
