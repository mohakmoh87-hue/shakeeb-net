import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// وضع علامة "مُباع/مُستخدم" على الكرت
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const updated = await prisma.rechargeCard.update({
    where: { id: Number(id) },
    data: { useDate: new Date(), userName: session?.fullName ?? session?.username },
  });
  return NextResponse.json(updated);
}
