import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// سجلّ المكافآت للمدير: منح/استخدام + إجماليات + مجموع الأرصدة القائمة (عزل بـ agentId)
export async function GET(request: Request) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;

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
