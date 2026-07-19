import webpush from "web-push";
import { prisma } from "./prisma";
import { fcmEnabled, sendFcmNotification } from "./fcm";

// إعداد VAPID مرّة واحدة — يعمل فقط إن ضُبطت المفاتيح في البيئة (وإلا يبقى Push معطّلاً بلا أخطاء).
let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@shakeebnet.com", pub, priv);
  configured = true;
  return true;
}

export function pushEnabled(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export type PushPayload = { title: string; body: string; tag?: string; url?: string };

// إرسال Push لمديري وكيلٍ — أفضل جهد عبر قناتين:
// (1) Web Push (VAPID) للمتصفح/PWA، (2) FCM للتطبيق الأصلي (WebView لا يدعم Web Push).
// يحذف الاشتراكات/الرموز الميتة.
export async function sendPushToAgent(agentId: number | null, payload: PushPayload): Promise<void> {
  if (agentId == null) return;

  // (1) Web Push (VAPID) — إن ضُبطت المفاتيح
  if (ensureConfigured()) {
    const subs = await prisma.pushSubscription.findMany({ where: { agentId } });
    if (subs.length > 0) {
      const data = JSON.stringify(payload);
      await Promise.all(
        subs.map(async (s) => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data);
          } catch (e: unknown) {
            const code = (e as { statusCode?: number })?.statusCode;
            if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          }
        }),
      );
    }
  }

  // (2) FCM — التطبيق الأصلي (مديرون سجّلوا رمز جهازهم عبر تطبيق الفنيين)
  if (fcmEnabled()) {
    const users = await prisma.user.findMany({
      where: { agentId, isDeleted: false, fcmToken: { not: null } },
      select: { id: true, fcmToken: true },
    });
    await Promise.all(
      users.map(async (u) => {
        const r = await sendFcmNotification(u.fcmToken, payload.title, payload.body);
        if (r.invalidToken) await prisma.user.update({ where: { id: u.id }, data: { fcmToken: null } }).catch(() => {});
      }),
    );
  }
}
