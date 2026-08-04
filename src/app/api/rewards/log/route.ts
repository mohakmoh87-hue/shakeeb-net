import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, guardAny, sameAgentTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// سجلّ المكافآت للمدير: منح/استخدام + إجماليات + مجموع الأرصدة القائمة (عزل بـ agentId)
export async function GET(request: Request) {
  // سجل مكافأة **مشترك واحد** متاح لمن يدير المشتركين (زر «سجل المكافأة» في عملياته)،
  // أما السجل العام لكل الوكيل فيبقى بصلاحية إعداد المكافآت. (حادثة تراكم ١٥٠٠ إلى
  // ٣٠٠٠ لم يكن في الواجهة ما يكشفها.)
  const subId = Number(new URL(request.url).searchParams.get("subscriberId"));
  const g = subId
    ? await guardAny("subscribers.manage", "rewards.config")
    : await guard("rewards.config");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;

  if (subId) {
    const sub = await prisma.subscriber.findUnique({
      where: { id: subId },
      select: { id: true, name: true, rewardCode: true, rewardBalance: true, rewardGrantCount: true, towerId: true, isDeleted: true },
    });
    if (!sub || sub.isDeleted || !(await sameAgentTower(g.session, sub.towerId))) {
      return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
    }
    const logs = await prisma.rewardLog.findMany({ where: { subscriberId: subId }, orderBy: { id: "desc" }, take: 200 });
    const granted = logs.filter((l) => l.kind === "grant").reduce((s2, l) => s2 + l.amount, 0);
    const redeemed = logs.filter((l) => l.kind === "redeem").reduce((s2, l) => s2 + l.amount, 0);
    const reversed = logs.filter((l) => l.kind === "reverse").reduce((s2, l) => s2 + l.amount, 0);
    return NextResponse.json({
      subscriber: { id: sub.id, name: sub.name, code: sub.rewardCode, balance: sub.rewardBalance ?? 0, grants: sub.rewardGrantCount ?? 0 },
      logs, granted, redeemed, reversed,
      expected: granted - redeemed - reversed,
    });
  }

  const kind = new URL(request.url).searchParams.get("kind"); // grant | redeem | (الكل)
  const where = { agentId: agentId ?? -1, ...(kind === "grant" || kind === "redeem" ? { kind } : {}) };

  const [logs, grantAgg, redeemAgg, outstanding] = await Promise.all([
    prisma.rewardLog.findMany({ where, orderBy: { id: "desc" }, take: 300 }),
    prisma.rewardLog.aggregate({ where: { agentId: agentId ?? -1, kind: "grant" }, _sum: { amount: true } }),
    prisma.rewardLog.aggregate({ where: { agentId: agentId ?? -1, kind: "redeem" }, _sum: { amount: true } }),
    // مجموع الأرصدة القائمة حالياً لدى مشتركي هذا الوكيل
    prisma.$queryRawUnsafe<{ sum: bigint | null }[]>(
      `SELECT COALESCE(SUM(s."rewardBalance"),0)::bigint AS sum FROM subscribers s JOIN towers t ON t.id = s."towerId" WHERE t."agentId" = $1 AND s."isDeleted" = false`,
      agentId ?? -1,
    ),
  ]);

  return NextResponse.json({
    logs,
    totalGranted: grantAgg._sum.amount ?? 0,
    totalRedeemed: redeemAgg._sum.amount ?? 0,
    outstanding: Number(outstanding[0]?.sum ?? 0),
  });
}
