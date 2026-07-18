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
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: g.session.userId, agentId: g.session.agentId ?? null, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId: g.session.userId, agentId: g.session.agentId ?? null, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  return NextResponse.json({ ok: true });
}

// إلغاء الاشتراك (عند إيقاف الإشعارات من الجهاز).
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return NextResponse.json({ ok: true });
}
