// إرسال إشعارات FCM (HTTP v1) لإيقاظ تطبيق الفني الأصلي عند طلب/إيقاف التتبع.
// المفتاح السرّي (حساب الخدمة) يُقرأ من متغيّر البيئة FIREBASE_SERVICE_ACCOUNT_B64 (base64).
// رسائل «data-only» عالية الأولوية: تصل حتى والتطبيق مُغلَق، وتُشغّل الخدمة الأصلية.
import { importPKCS8, SignJWT } from "jose";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cachedSa: ServiceAccount | null | undefined;
let cachedToken: { token: string; exp: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  if (cachedSa !== undefined) return cachedSa;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) { cachedSa = null; return null; }
  try {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccount;
    cachedSa = sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch { cachedSa = null; }
  return cachedSa;
}

// هل تكامل FCM مُفعَّل (المفتاح موجود)؟
export function fcmEnabled(): boolean {
  return !!serviceAccount();
}

// رمز وصول OAuth2 قصير العمر (يُخزَّن بالذاكرة ~ساعة)
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) throw new Error("FCM auth failed: " + JSON.stringify(data));
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

export type FcmResult = { ok: boolean; error?: string; invalidToken?: boolean };

// إرسال رسالة FCM لجهاز واحد. message = جسم رسالة FCM v1 (بلا token — يُضاف هنا).
async function sendFcm(deviceToken: string, message: Record<string, unknown>): Promise<FcmResult> {
  const sa = serviceAccount();
  if (!sa) return { ok: false, error: "no-service-account" };
  try {
    const token = await accessToken(sa);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token: deviceToken, ...message } }),
    });
    if (res.ok) return { ok: true };
    const err = (await res.json().catch(() => ({}))) as {
      error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
    };
    const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode || err?.error?.status || "";
    // الرمز غير مُسجَّل/باطل ⇒ يُمسح. (لا نمسح على أخطاء الطلب العامة)
    const invalidToken = code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH" || res.status === 404;
    return { ok: false, error: JSON.stringify(err?.error ?? err), invalidToken };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// رسالة data-only عالية الأولوية (لإيقاظ خدمة التتبع حتى والتطبيق مُغلَق).
export async function sendFcmData(deviceToken: string | null | undefined, data: Record<string, string>): Promise<FcmResult> {
  if (!deviceToken) return { ok: false, error: "no-device-token" };
  return sendFcm(deviceToken, { android: { priority: "high", ttl: "120s" }, data });
}

// رسالة إشعار (عنوان/نص) — يعرضها أندرويد في شريط الإشعارات تلقائياً والتطبيق مُغلَق/بالخلفية.
export async function sendFcmNotification(
  deviceToken: string | null | undefined,
  title: string,
  body: string,
): Promise<FcmResult> {
  if (!deviceToken) return { ok: false, error: "no-device-token" };
  return sendFcm(deviceToken, {
    notification: { title, body },
    android: { priority: "high", notification: { sound: "default" } },
  });
}
