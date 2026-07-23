import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// سجل التدقيق (للمدير فقط)
// عزل المستأجر: المدير يرى أحداث مستخدمي وكيله فقط (كان يعرض كل الوكلاء)؛ المالك يرى الكل
export async function GET() {
  const g = await guard("users.manage");
  if (g.error) return g.error;

  const logs = await prisma.auditLog.findMany({
    where: g.session?.isOwner ? {} : { user: { agentId: g.session?.agentId ?? -1 } },
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
