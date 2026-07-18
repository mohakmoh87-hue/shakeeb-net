import webpush from "web-push";
import { prisma } from "./prisma";

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

// إرسال Push لكل مشترِكي وكيلٍ (المديرون) — أفضل جهد؛ يحذف الاشتراكات الميتة (404/410).
export async function sendPushToAgent(agentId: number | null, payload: PushPayload): Promise<void> {
  if (!ensureConfigured() || agentId == null) return;
  const subs = await prisma.pushSubscription.findMany({ where: { agentId } });
  if (subs.length === 0) return;
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
