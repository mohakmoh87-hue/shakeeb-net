import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

// تخزين اشتراك Web Push للمدير (upsert بالـ endpoint). لصاحب صلاحية إدارة الفنيين.
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "اشتراك غير صحيح" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  // technicianId:null إلزاميّ — الصفُّ واحدٌ لكلّ endpoint، فلو كان الاشتراكُ سابقاً لفنيٍّ على
  // نفس المتصفّح لظلّ technicianId مضبوطاً فيلتقطه بثُّ الفنيّ ويصلُ إشعارُه جهازَ المدير (تسريبُ عزل).
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: g.session.userId, agentId: g.session.agentId ?? null, technicianId: null, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId: g.session.userId, agentId: g.session.agentId ?? null, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  return NextResponse.json({ ok: true });
}

// إلغاء الاشتراك (عند إيقاف الإشعارات من الجهاز). العزل: يحذف صفَّ هذا المستخدم وحدَه
// (endpoint + userId) لا أيَّ صفٍّ بالـendpoint — وإلا حذف مديرٌ اشتراكَ فنيٍّ أو وكيلٍ آخر.
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: g.session.userId } });
  return NextResponse.json({ ok: true });
}
