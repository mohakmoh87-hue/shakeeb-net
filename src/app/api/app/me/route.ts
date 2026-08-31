import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { subscriberState } from "@/lib/subscriberLogin";
import { remaining, formatExpiryDay } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const sub = await prisma.subscriber.findUnique({
    where: { id: sess.subscriberId },
    select: { id: true, name: true, netUser: true, phone: true, packageId: true, dateFrom: true, dateTo: true, carry: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  const pkg = sub.packageId ? await prisma.package.findUnique({ where: { id: sub.packageId }, select: { name: true, priceDinar: true, priceDollar: true } }) : null;
  const st = subscriberState(sub.dateTo);
  const rem = remaining(sub.dateTo);
  const daysLeft = rem && !rem.negative ? rem.days : 0;
  const expired = rem ? rem.negative : false;
  const priceLabel = pkg?.priceDinar
    ? `${Math.round(pkg.priceDinar).toLocaleString("en-US")} د.ع`
    : pkg?.priceDollar
      ? `$${pkg.priceDollar}`
      : "";
  return NextResponse.json({
    name: sub.name, netUser: sub.netUser, phone: sub.phone,
    package: pkg?.name ?? null, priceLabel,
    dateTo: sub.dateTo, expiryLabel: sub.dateTo ? formatExpiryDay(sub.dateTo) : "",
    daysLeft, expired, carry: sub.carry ?? 0,
    state: st.state, daysExpired: st.daysExpired,
  });
}
