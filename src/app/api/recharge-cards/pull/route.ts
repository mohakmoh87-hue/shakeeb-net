import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({ packageId: z.coerce.number() });

// سحب كارت: حجز ذرّي لأول كارت متاح (يمنع تعارض مكتبين في نفس اللحظة)
export async function POST(request: Request) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;
  const userId = g.session!.userId;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "الفئة مطلوبة" }, { status: 400 });
  }
  const { packageId } = parsed.data;

  // الحجوزات الأقدم من 5 دقائق تُعتبر منتهية
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);

  const agentId = g.session?.agentId ?? -1; // عزل: كروت وكيل المستخدم
  // محاولة حجز كارت متاح ذرّياً (updateMany بشرط يضمن عدم أخذ نفس الكارت مرتين)
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = await prisma.rechargeCard.findFirst({
      where: {
        packageId,
        useDate: null,
        agentId,
        OR: [{ reservedAt: null }, { reservedAt: { lt: staleBefore } }],
      },
      orderBy: { id: "asc" },
      select: { id: true, serial: true },
    });
    if (!candidate) break;

    const res = await prisma.rechargeCard.updateMany({
      where: {
        id: candidate.id,
        useDate: null,
        agentId,
        OR: [{ reservedAt: null }, { reservedAt: { lt: staleBefore } }],
      },
      data: { reservedBy: userId, reservedAt: new Date() },
    });
    if (res.count === 1) {
      const available = await prisma.rechargeCard.count({
        where: { packageId, useDate: null, agentId },
      });
      return NextResponse.json({ card: candidate, available });
    }
    // أخذه مكتب آخر بنفس اللحظة → جرّب الكارت التالي
  }

  return NextResponse.json(
    { error: "لا توجد كروت متاحة لهذه الفئة" },
    { status: 400 },
  );
}
