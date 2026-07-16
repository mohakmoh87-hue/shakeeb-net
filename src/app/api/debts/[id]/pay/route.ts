import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
});

// تسديد دين مشترك: يقلّل الدين + يسجّل قبضاً في الصندوق
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("finance.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const subscriberId = Number(id);
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { amount } = parsed.data;

  const subscriber = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
  });
  if (!subscriber || subscriber.isDeleted || !(await ownsTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  const currentCarry = subscriber.carry ?? 0;
  const newCarry = Math.max(0, currentCarry - amount);

  await prisma.$transaction([
    prisma.subscriber.update({
      where: { id: subscriberId },
      data: { carry: newCarry },
    }),
    prisma.moneyTx.create({
      data: {
        moneyIn: amount,
        moneyOut: 0,
        notes: `تسديد دين - ${subscriber.name ?? subscriberId}`,
        date: new Date(),
        serverDate: new Date(),
        userId: session?.userId,
        sourceType: "debt", sourceId: subscriberId, towerId: subscriber.towerId,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: session?.userId,
        action: "PAY_DEBT",
        entity: "subscriber",
        entityId: String(subscriberId),
        details: `تسديد ${amount} - المتبقّي ${newCarry}`,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, newCarry });
}
