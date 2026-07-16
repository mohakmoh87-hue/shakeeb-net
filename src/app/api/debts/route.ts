import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

// قائمة المشتركين المدينين (carry > 0)
export async function GET() {
  const g = await guard("finance.view");
  if (g.error) return g.error;

  const debtors = await prisma.subscriber.findMany({
    where: { isDeleted: false, carry: { gt: 0 }, ...(await towerScope(g.session)) },
    orderBy: { carry: "desc" },
    select: {
      id: true,
      name: true,
      phone: true,
      carry: true,
      towerId: true,
    },
  });
  const total = debtors.reduce((s, d) => s + (d.carry ?? 0), 0);

  return NextResponse.json({ debtors, total, count: debtors.length });
}
