import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({ cardId: z.coerce.number() });

// إرجاع كارت محجوز للمخزون (عند إلغاء التفعيل دون تأكيد)
export async function POST(request: Request) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  // يُرجَع فقط إن لم يُستخدم نهائياً — وضمن كروت وكيل المستخدم (عزل)
  await prisma.rechargeCard.updateMany({
    where: { id: parsed.data.cardId, useDate: null, agentId: g.session?.agentId ?? -1 },
    data: { reservedBy: null, reservedAt: null },
  });
  return NextResponse.json({ ok: true });
}
