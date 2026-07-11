import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// المشتركون الذين لم يفعّلوا اشتراكهم خلال المدة المحدّدة
export async function GET(request: Request) {
  const g = await guard("reports.view");
  if (g.error) return g.error;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(new Date().setDate(1));
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date();
  to.setHours(23, 59, 59, 999);

  // معرّفات من فعّلوا خلال المدة
  const activated = await prisma.subscriptionEntry.groupBy({
    by: ["subscriberId"],
    where: { isDeleted: false, date: { gte: from, lte: to }, subscriberId: { not: null } },
  });
  const activatedIds = activated.map((a) => a.subscriberId).filter(Boolean) as number[];

  // المشتركون الذين ليسوا ضمن من فعّل
  const subscribers = await prisma.subscriber.findMany({
    where: { isDeleted: false, id: { notIn: activatedIds } },
    select: { id: true, name: true, phone: true, netUser: true, dateTo: true },
    orderBy: { name: "asc" },
    take: 5000,
  });

  return NextResponse.json({ count: subscribers.length, subscribers });
}
