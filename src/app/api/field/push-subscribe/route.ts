import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// اشتراكُ Web Push للفنيّ (المتصفّح/الـPWA — آيفون خصوصاً، إذ لا يمرّ عبر FCM).
// العزل: الفنيُّ يكتب صفَّه وحدَه (technicianId من جلسته)، والصفُّ بلا userId/agentId
// كي لا يُلتقَط في بثّ المدير (sendPushToAgent/User يستعلمان بهما).
const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "اشتراك غير صحيح" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { technicianId: tech.technicianId, userId: null, agentId: null, p256dh: keys.p256dh, auth: keys.auth },
    create: { technicianId: tech.technicianId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint, technicianId: tech.technicianId } });
  return NextResponse.json({ ok: true });
}
