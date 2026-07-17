import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { redeemReward, sendRewardUsedMessage } from "@/lib/rewards";

export const dynamic = "force-dynamic";

const schema = z.object({
  itemId: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  price: z.coerce.number().min(0, "السعر غير صحيح"), // سعر البيع (قابل للتعديل أثناء البيع)
  received: z.coerce.number().min(0).default(0), // المبلغ الواصل
  subscriberId: z.coerce.number().int().positive().nullable().optional(), // مشترك (لسحب كود المكافأة)
  useReward: z.boolean().optional().default(false), // سحب كود مكافأة المشترك خصماً
});

// بيع مباشر من المخزن — غير مرتبط بمشترك.
// أي مستخدم (بصلاحية المخزن) يستطيع تعديل السعر لحظة البيع.
// يُنقِص كمية المادة ويسجّل الواصل في الصندوق (يظهر بالتقرير اليومي كمقبوضات).
export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const session = g.session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { itemId, qty, price, received, subscriberId, useReward } = parsed.data;

  const item = await prisma.item.findFirst({ where: { id: itemId, isDeleted: false } });
  if (!item) return NextResponse.json({ error: "المادة غير موجودة" }, { status: 404 });

  // عزل المكاتب: مستخدم المكتب يبيع من مخزن مكتبه فقط
  if (session && !session.isAdmin && session.towerId != null && item.towerId !== session.towerId) {
    return NextResponse.json({ error: "لا يمكنك البيع من مخزن مكتب آخر" }, { status: 403 });
  }

  // المتوفّر بالمكتب = الكمية الكلية − ما هو بذمم الفنيين
  const custodyAgg = await prisma.custody.aggregate({
    where: { itemId, isDeleted: false }, _sum: { qty: true },
  });
  const atOffice = (item.count ?? 0) - (custodyAgg._sum.qty ?? 0);
  if (qty > atOffice) {
    return NextResponse.json({ error: `الكمية المتوفّرة بالمكتب ${atOffice} فقط` }, { status: 400 });
  }

  const total = qty * price;

  // سحب كود مكافأة مشترك (اختياري): يُخصم من إجمالي البيع، ويبقى الباقي للمشترك
  let rewardSubId: number | null = null;
  if (useReward && subscriberId) {
    const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { towerId: true, rewardBalance: true } });
    if (sub && (await ownsTower(session, sub.towerId)) && (sub.rewardBalance ?? 0) > 0) {
      const off = item.towerId ? await prisma.tower.findUnique({ where: { id: item.towerId }, select: { rewardsEnabled: true } }) : null;
      if (off?.rewardsEnabled === "1") rewardSubId = subscriberId;
    }
  }

  let discount = 0;
  const tx = await prisma.$transaction(async (t) => {
    if (rewardSubId) {
      const r = await redeemReward(t, {
        subscriberId: rewardSubId, billAmount: total, context: "sale", refId: itemId,
        towerId: item.towerId ?? null, agentId: session?.agentId ?? null, createdByUser: session?.username, createdByName: session?.fullName ?? undefined,
      });
      discount = r?.discount ?? 0;
    }
    const netDue = Math.max(0, total - discount); // المستحقّ بعد المكافأة
    const remaining = Math.max(0, netDue - received);
    await t.item.update({ where: { id: itemId }, data: { count: (item.count ?? 0) - qty } });
    const mtx = await t.moneyTx.create({
      data: {
        moneyIn: received, moneyOut: 0, date: new Date(), serverDate: new Date(),
        userId: session?.userId, sourceType: "sale", sourceId: itemId, towerId: item.towerId ?? null,
        notes: `بيع ${item.name ?? "مادة"} × ${qty} بسعر ${price.toLocaleString("en-US")}` +
          (discount > 0 ? ` (مكافأة −${discount.toLocaleString("en-US")})` : "") +
          (remaining > 0 ? ` (واصل ${received.toLocaleString("en-US")}، متبقّي ${remaining.toLocaleString("en-US")})` : ""),
      },
    });
    return { id: mtx.id, netDue, remaining };
  });

  // رسالة تأكيد استخدام المكافأة (أفضل جهد)
  if (rewardSubId && discount > 0) {
    const rs = await prisma.subscriber.findUnique({ where: { id: rewardSubId }, select: { phone: true, waEnabled: true, name: true, rewardBalance: true } });
    if (rs) void sendRewardUsedMessage({
      subscriberId: rewardSubId, officeId: item.towerId ?? null, agentId: session?.agentId ?? null,
      phone: rs.phone, waEnabled: rs.waEnabled, name: rs.name, discount, balance: rs.rewardBalance ?? 0, createdByUser: session?.username,
    });
  }

  return NextResponse.json({ ok: true, txId: tx.id, total, discount, received, remaining: tx.remaining });
}
