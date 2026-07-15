import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// سجل صيانات المشترك (بجانب سجل الوصولات) — تفاصيل من الفنيين وتواريخها.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const { id } = await params;
  const subscriberId = Number(id);
  if (!subscriberId) return NextResponse.json({ logs: [] });

  // عزل بين المكاتب: لا يُقرأ سجل مشترك مكتب آخر
  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { towerId: true } });
  if (!sub || !ownsTower(g.session, sub.towerId)) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  const logs = await prisma.maintenanceLog.findMany({
    where: { subscriberId },
    orderBy: { date: "desc" },
  });
  return NextResponse.json({ logs });
}
