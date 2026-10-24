import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { subscriberState } from "@/lib/subscriberLogin";
import { remaining, formatExpiryDay } from "@/lib/format";
import { ensureMarketTable } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  await ensureMarketTable(); // عمودُ الاسم المستعار يُنشأ كسولاً مع جداول السوق
  const sub = await prisma.subscriber.findUnique({
    where: { id: sess.subscriberId },
    select: { id: true, name: true, netUser: true, phone: true, address: true, sector: true, packageId: true, dateFrom: true, dateTo: true, carry: true, appBanned: true, towerId: true, rewardBalance: true, appNickname: true },
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
    nickname: sub.appNickname ?? "",
    officeName: office?.name ?? "", agentName: agent?.name ?? "",
    dateFrom: sub.dateFrom, startLabel: sub.dateFrom ? formatExpiryDay(sub.dateFrom) : "",
    rewardsEnabled, rewardBalance: rewardsEnabled ? (sub.rewardBalance ?? 0) : null,
    state: st.state, daysExpired: st.daysExpired,
  });
}

// ✏️ الاسمُ المستعار — يختاره المشترك ويظهر في سوق المستعمل بدل اسمه (طلبُ محمد).
// 🔒 صفُّ صاحب الجلسة وحدَه، ولا يُقبَل مشتركٌ من الطلب. والفراغُ يمحوه فيعود اسمُه.
export async function PATCH(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  await ensureMarketTable();
  const sub = await prisma.subscriber.findFirst({
    where: { id: sess.subscriberId, isDeleted: false, purgedAt: null },
    select: { id: true, appBanned: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (sub.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (typeof b?.nickname !== "string") return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  const raw = b.nickname.replace(/\s+/g, " ").trim();
  if (raw && raw.length < 2) return NextResponse.json({ error: "الاسمُ المستعار حرفان على الأقلّ" }, { status: 400 });
  if (raw.length > 40) return NextResponse.json({ error: "الاسمُ المستعار طويلٌ جدّاً" }, { status: 400 });
  await prisma.subscriber.update({ where: { id: sub.id }, data: { appNickname: raw || null } });
  return NextResponse.json({ ok: true, nickname: raw });
}
