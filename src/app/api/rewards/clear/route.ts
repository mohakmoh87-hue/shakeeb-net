import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// مسح كود ورصيد مكافأة أي مشترك يدوياً
export async function POST(request: Request) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const parsed = z.object({ subscriberId: z.coerce.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const sub = await prisma.subscriber.findUnique({ where: { id: parsed.data.subscriberId }, select: { id: true, name: true, towerId: true, rewardBalance: true, rewardCode: true } });
  if (!sub || !(await ownsTower(g.session, sub.towerId))) return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });

  if ((sub.rewardBalance ?? 0) === 0 && !sub.rewardCode) {
    return NextResponse.json({ ok: true, already: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscriber.update({ where: { id: sub.id }, data: { rewardCode: null, rewardBalance: 0 } });
    await tx.rewardLog.create({
      data: {
        agentId: g.session?.agentId ?? null, towerId: sub.towerId, subscriberId: sub.id,
        kind: "clear", amount: sub.rewardBalance ?? 0, code: sub.rewardCode, context: "manual", balanceAfter: 0,
        subscriberName: sub.name, createdByUser: session?.username, createdByName: session?.fullName,
      },
    });
  });
  return NextResponse.json({ ok: true });
}
