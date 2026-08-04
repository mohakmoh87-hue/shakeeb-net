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

  // عزل: لا يُحذف إلا كروت وكيل المستخدم غير المستخدمة
  const where = { id: { in: parsed.data.ids }, useDate: null, agentId: g.session?.agentId ?? -1 };
  // المبلغ الذي سينقص من «ديون الكارتات» — بنفس شرط الحذف حرفياً وقبله
  // (المحذوف فعلاً قد يقلّ عن المحدَّد، فتقدير المتصفح وحده يضلّل)
  const agg = await prisma.rechargeCard.aggregate({ where, _sum: { price: true } });
  const removedDebt = agg._sum?.price ?? 0;
  // السيريلات قبل الحذف — الحذف فيزيائي فلا سبيل لمعرفتها بعده (المرحلة ٨)
  const doomed = await prisma.rechargeCard.findMany({ where, select: { serial: true }, take: 500 });
  const res = await prisma.rechargeCard.deleteMany({ where });
  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId,
      action: "DELETE_CARDS", entity: "rechargeCard", entityId: String(res.count),
      details:
        "حذف " + res.count + " كارتاً — ينقص ديون الكارتات " +
        removedDebt.toLocaleString("en-US") + " — سيريلات: " +
        doomed.map((c) => c.serial).filter(Boolean).join(", ").slice(0, 4000),
    },
  });
  return NextResponse.json({ ok: true, deleted: res.count, removedDebt });
}
