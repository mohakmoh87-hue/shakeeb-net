import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { subscriberState } from "@/lib/subscriberLogin";

export const dynamic = "force-dynamic";

export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const sub = await prisma.subscriber.findUnique({
    where: { id: sess.subscriberId },
    select: { id: true, name: true, netUser: true, phone: true, packageId: true, dateFrom: true, dateTo: true, carry: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  const pkg = sub.packageId ? await prisma.package.findUnique({ where: { id: sub.packageId }, select: { name: true } }) : null;
  const st = subscriberState(sub.dateTo);
  return NextResponse.json({
    name: sub.name, netUser: sub.netUser, phone: sub.phone,
    package: pkg?.name ?? null, dateTo: sub.dateTo, carry: sub.carry ?? 0,
    state: st.state, daysExpired: st.daysExpired,
  });
}
