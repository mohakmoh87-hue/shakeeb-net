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

// ═════ أ-٢٢ · إشعارُ **الفنيّ** على هاتفه (طلب محمد 2026-08-12) ═════
// «عند توجيه بطاقةٍ على فنيّ يجب أن يذهب إشعارٌ إلى هاتفه… لأنّ الفنيَّ الآن يضطرّ إلى
// فتح التطبيق في كلّ مرّةٍ ليبحث عن بطاقاتٍ جديدة.»
// كانت القناةُ غائبةً من النظام كلّه: `Technician.fcmToken` يُسجَّل من التطبيق ولا
// يستهلكه إلّا إيقاظُ تتبّع GPS — و`sendFcmNotification` لا تُنادى لفنيٍّ إطلاقاً.
// وهي على نمط نظيرتها للمديرين حرفيّاً: تقرأ الرمزَ، تُرسل، وتُفرّغه إن كان باطلاً.
// 🔒 العزلُ ضمنيّ: الإشعارُ إلى رمزِ ذلك الفنيّ وحدَه — لا قراءةَ رموزٍ بغير technicianId.
// وفنيٌّ بلا رمزٍ (لم يُثبّت التطبيق أو لم يمنح الإذن) يُتخطّى بصمتٍ — أفضلُ جهد.
export async function sendPushToTechnician(technicianId: number | null, payload: PushPayload): Promise<void> {
  if (technicianId == null || !fcmEnabled()) return;
  const tech = await prisma.technician.findUnique({
    where: { id: technicianId },
    select: { id: true, fcmToken: true, isDeleted: true },
  });
  if (!tech || tech.isDeleted || !tech.fcmToken) return;
  const r = await sendFcmNotification(tech.fcmToken, payload.title, payload.body);
  if (r.invalidToken) {
    await prisma.technician.update({ where: { id: tech.id }, data: { fcmToken: null } }).catch(() => {});
  }
}
