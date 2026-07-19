// جسر التطبيق الأصلي (Capacitor) لتتبّع الموقع في الخلفية.
// آلية العمل: المدير يضغط «تتبع» ⇒ الخادم يرسل إشعار FCM ⇒ خدمة أصلية (Java) تبدأ
// وترسل الموقع حتى والتطبيق مُغلَق، وتُطفأ حين يوقف المدير التتبع. لا استهلاك بلا طلب.
// دور الويب هنا: تسجيل رمز جهاز FCM ليتمكّن الخادم من إيقاظنا + فتح الإعدادات عند رفض الإذن.
// في المتصفح العادي: كل الدوال تعيد بهدوء دون أثر (الموقع لا يتأثر).
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

// جسر رمز FCM (إضافة Java: PushTokenPlugin)
const PushToken = registerPlugin<{ getToken(): Promise<{ token: string }> }>("PushToken");
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
    const { token } = await PushToken.getToken();
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

// فتح إعدادات التطبيق (لتفعيل إذن الموقع «السماح دائماً» يدوياً إن رُفض)
export async function openNativeSettings(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await BG.openSettings();
  } catch {
    /* تجاهل */
  }
}
