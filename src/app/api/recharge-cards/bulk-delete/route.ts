import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({
  ids: z.array(z.coerce.number()).min(1, "لم تُحدَّد كروت"),
});

// حذف جماعي لكروت التفعيل من المخزن نهائياً (صلاحية cards.delete).
// يُحذف من قاعدة البيانات كأنها لم تُضف، فينقص مبلغها من ديون الكارتات.
// يُسمح بحذف الكروت غير المستخدمة فقط (في المخزن).
export async function POST(request: Request) {
  const g = await guard("cards.delete");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }

  const res = await prisma.rechargeCard.deleteMany({
    where: { id: { in: parsed.data.ids }, useDate: null },
  });
  return NextResponse.json({ ok: true, deleted: res.count });
}
