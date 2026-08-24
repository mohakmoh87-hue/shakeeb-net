import { prisma } from "./prisma";
import { sendPushToAgent } from "./push";

// ينشئ إشعاراً في القائمة (للمدير) ويُرسل Push للهاتف — أفضل جهد، لا يُفشِل العملية الأصلية.
export async function notify(opts: {
  agentId: number | null; towerId: number | null; type: string;
  title: string; body: string; refType?: string; refId?: number; url?: string;
  // ═══ مُخاطَبٌ بعينه (طلبُ محمد 2026-08-14: تكليفُ حالةٍ لشخصٍ فتظهر في إشعاراته) ═══
  // و`null` أو غيابُها = **للجميع** كما كان — فلا يتغيّر شيءٌ في كلّ نداءٍ قائم.
  userId?: number | null; technicianId?: number | null;
}): Promise<void> {
  // 🔗 الرابطُ يُخزَّن (كان يُمرَّر للدفعة ويُرمى) — فيصير الإشعارُ قابلاً للنقر مهما كان نوعُه.
  const base = {
    agentId: opts.agentId, towerId: opts.towerId, type: opts.type,
    title: opts.title, body: opts.body, refType: opts.refType ?? null, refId: opts.refId ?? null,
    userId: opts.userId ?? null, technicianId: opts.technicianId ?? null,
  };
  try {
    await prisma.notification.create({ data: { ...base, url: opts.url ?? null } });
  } catch {
    // ⏳ عمودُ `url` يُضاف بلصق SQL؛ وقبل لصقه لا يجوز أن تتوقّف الإشعاراتُ كلُّها —
    //    فتُعاد المحاولةُ بالحقول القديمة وحدَها. (وبعد اللصق يمرّ الفرعُ الأوّل دائماً.)
    try { await prisma.notification.create({ data: base }); } catch { /* لا يُفشل الحدث الأصلي */ }
  }
  void sendPushToAgent(opts.agentId, { title: opts.title, body: opts.body, tag: opts.type, url: opts.url ?? "/field-management" }).catch(() => {});
}
