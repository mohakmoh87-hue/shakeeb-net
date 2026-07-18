import { prisma } from "./prisma";
import { sendPushToAgent } from "./push";

// ينشئ إشعاراً في القائمة (للمدير) ويُرسل Push للهاتف — أفضل جهد، لا يُفشِل العملية الأصلية.
export async function notify(opts: {
  agentId: number | null; towerId: number | null; type: string;
  title: string; body: string; refType?: string; refId?: number; url?: string;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        agentId: opts.agentId, towerId: opts.towerId, type: opts.type,
        title: opts.title, body: opts.body, refType: opts.refType ?? null, refId: opts.refId ?? null,
      },
    });
  } catch {
    // لا يُفشل الحدث الأصلي إن تعذّر إنشاء الإشعار
  }
  void sendPushToAgent(opts.agentId, { title: opts.title, body: opts.body, tag: opts.type, url: opts.url ?? "/field-management" }).catch(() => {});
}
