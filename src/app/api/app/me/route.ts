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
    select: { id: true, name: true, netUser: true, phone: true, address: true, sector: true, packageId: true, dateFrom: true, dateTo: true, carry: true, appBanned: true, towerId: true, rewardBalance: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  // حظرُ أدمن التطبيق: تُبطَل جلسةُ المحظور فوراً (يُخرَجُ من التطبيق عند أوّل طلب)
  if (sub.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });
  const pkg = sub.packageId ? await prisma.package.findUnique({ where: { id: sub.packageId }, select: { name: true, priceDinar: true, priceDollar: true } }) : null;
  // مكتبُه ووكيله — لشاشة «بياناتي الشخصيّة»، ومنه حالةُ المكافآت.
  // صفُّ المشترك نفسِه بجلسته وحدَها: لا ملاحظاتٍ داخليّةً ولا رقمَ غيره.
  const office = sub.towerId ? await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { name: true, agentId: true, rewardsEnabled: true } }) : null;
  const agent = office?.agentId ? await prisma.agent.findUnique({ where: { id: office.agentId }, select: { name: true } }) : null;
  const rewardsEnabled = office?.rewardsEnabled === "1";
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
    address: sub.address ?? "", sector: sub.sector ?? "",
    officeName: office?.name ?? "", agentName: agent?.name ?? "",
    dateFrom: sub.dateFrom, startLabel: sub.dateFrom ? formatExpiryDay(sub.dateFrom) : "",
    rewardsEnabled, rewardBalance: rewardsEnabled ? (sub.rewardBalance ?? 0) : null,
    state: st.state, daysExpired: st.daysExpired,
  });
}
