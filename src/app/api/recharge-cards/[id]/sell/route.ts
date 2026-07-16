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
  // عزل: لا يُباع إلا كارت يتبع وكيل المستخدم
  const res = await prisma.rechargeCard.updateMany({
    where: { id: Number(id), agentId: session?.agentId ?? -1 },
    data: { useDate: new Date(), userName: session?.fullName ?? session?.username },
  });
  if (res.count === 0) return NextResponse.json({ error: "الكارت غير موجود ضمن حسابك" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
