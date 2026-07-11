import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// مسح دين مشترك (إسقاط الدين) — يصفّر الرصيد المرحّل carry
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("receipts.void");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const subscriberId = Number(id);

  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!sub || sub.isDeleted || !ownsTower(g.session, sub.towerId)) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  const prev = sub.carry ?? 0;
  await prisma.$transaction([
    prisma.subscriber.update({ where: { id: subscriberId }, data: { carry: 0 } }),
    prisma.auditLog.create({
      data: {
        userId: session?.userId, action: "CLEAR_DEBT", entity: "subscriber", entityId: String(subscriberId),
        details: `مسح دين ${prev} - ${sub.name ?? subscriberId}`,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
