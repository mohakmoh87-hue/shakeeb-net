import { prisma } from "@/lib/prisma";
import { sendViaProvider } from "@/lib/messaging";

// ═════ إشعارُ المشترك بتطوّرٍ على بطاقة طلبه (طلبُ محمد 2026-09-04) ═════
// **مقصورٌ على بطاقات `viaSubscriber`** (طلباتُ التطبيق) فحجمُ الرسائل منخفض — لا يشمل
// بطاقاتِ المكتب/أودو فلا يُغرِق واتساب المكتب. يصل حتى والتطبيق مغلق، ورابطٌ فيه يفتح
// التطبيقَ على البطاقة. صامتٌ وغيرُ معطِّل — تطوّرُ البطاقة أهمُّ من رسالةٍ عنه.
export async function notifySubscriberCardEvent(cardId: number, statusText: string): Promise<void> {
  try {
    const card = await prisma.taskCard.findUnique({
      where: { id: cardId },
      select: { id: true, kind: true, subscriberId: true, viaSubscriber: true },
    });
    if (!card || !card.viaSubscriber || card.subscriberId == null) return;
    const sub = await prisma.subscriber.findUnique({
      where: { id: card.subscriberId },
      select: { id: true, phone: true, waEnabled: true, towerId: true },
    });
    if (!sub?.phone || sub.waEnabled === false || sub.towerId == null) return;
    const office = await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { agentId: true, waEnabled: true } });
    if (!office || office.waEnabled === "0") return; // واتساب المكتب مطفأ
    const link = `https://shakeebnet.com/app?card=${card.id}`;
    const text = `🔔 تحديثٌ على طلبك${card.kind ? ` (${card.kind})` : ""}:\n${statusText}\n\nلمتابعة طلبك: ${link}`;
    const res = await sendViaProvider("WHATSAPP", sub.phone, text, sub.towerId, undefined);
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
        createdByUser: "card-status", agentId: office.agentId ?? null,
      },
    }).catch(() => {});
  } catch { /* صامتٌ تماماً */ }
}
