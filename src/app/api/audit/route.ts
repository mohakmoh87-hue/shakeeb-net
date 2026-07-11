import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// سجل التدقيق (للمدير فقط)
export async function GET() {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const logs = await prisma.auditLog.findMany({
    orderBy: { id: "desc" },
    take: 300,
    include: { user: { select: { fullName: true, username: true } } },
  });
  return NextResponse.json(
    logs.map((l) => ({
      id: l.id,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      details: l.details,
      user: l.user?.fullName ?? l.user?.username ?? "—",
      date: l.createdAt,
    })),
  );
}
