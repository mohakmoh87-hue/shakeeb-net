import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// إضافة ديون سابقة على المشترك — المبلغ + تفاصيله فقط، بلا كارت/باقة/تفعيل وبلا مكافأة.
const schema = z.object({
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  note: z.string().nullable().optional(), // تفاصيل المبلغ
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const subscriberId = Number(id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { amount, note } = parsed.data;

  const subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!subscriber || subscriber.isDeleted || !(await ownsTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  const now = new Date();
  const newCarry = (subscriber.carry ?? 0) + amount;

  const entry = await prisma.$transaction(async (tx) => {
    await tx.subscriber.update({ where: { id: subscriberId }, data: { carry: newCarry } });
    // قيد دَيْن فقط (لا واصل، لا نقد للصندوق) — يظهر في سجل وصولات المشترك
    const e = await tx.subscriptionEntry.create({
      data: {
        subscriberId, date: now, money: amount, moneyIn: 0, moneyCarry: newCarry,
        moneyType: 2, cardType: "ديون سابقة", notes: note ?? null,
        towerId: subscriber.towerId, createdByUser: session?.username,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session?.userId, action: "ADD_DEBT", entity: "subscriber", entityId: String(subscriberId),
        details: `إضافة ديون سابقة ${amount} - ${note ?? ""} - مجموع الدين ${newCarry}`,
      },
    });
    return e;
  });

  return NextResponse.json({ ok: true, entryId: entry.id, newCarry });
}
