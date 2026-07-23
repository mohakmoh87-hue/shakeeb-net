import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { redeemReward, sendRewardUsedMessage } from "@/lib/rewards";

const schema = z.object({
  subscriberId: z.coerce.number().optional().nullable(), // إلزامي إلا مع البيع المباشر
  direct: z.boolean().optional().default(false), // بيع مباشر: بلا مشترك (نقدي)
  customerName: z.string().max(120).optional().nullable(), // اسم الزبون (اختياري للبيع المباشر)
  items: z
    .array(
      z.object({
        itemId: z.coerce.number(),
        count: z.coerce.number().positive(),
        price: z.coerce.number().min(0),
      }),
    )
    .min(1, "أضف مادة واحدة على الأقل"),
  note: z.string().nullable().optional(),
  paid: z.coerce.number().min(0).default(0),
  useReward: z.boolean().optional().default(false), // سحب كود مكافأة المشترك خصماً
});

// سجل وصولات فواتير المبيع — مع اسم المشترك/الزبون.
// العزل: فواتير مكاتب وكيل المستخدم فقط (+ فواتير بلا مكتب أنشأها هو) — كانت بلا فلترة
export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const { towerScope } = await import("@/lib/guard");
  const scope = await towerScope(g.session);
  const invoices = await prisma.invoice.findMany({
    where: { isDeleted: false, OR: [{ ...scope }, { towerId: null, user: g.session.username }] },
    orderBy: { id: "desc" },
    take: 200,
  });
  const subIds = [...new Set(invoices.map((i) => i.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true } })
    : [];
  const nameMap = new Map(subs.map((s) => [s.id, s.name ?? s.netUser ?? `#${s.id}`]));
  return NextResponse.json(invoices.map((i) => ({
    ...i,
    subscriberName: i.subscriberId != null ? nameMap.get(i.subscriberId) ?? null : null,
  })));
}

export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { subscriberId, direct, customerName, items, note, paid, useReward } = parsed.data;

  // المشترك إلزامي إلا في البيع المباشر (نقدي بلا مشترك — لا دين ولا مكافأة)
  let subscriber: Awaited<ReturnType<typeof prisma.subscriber.findUnique>> = null;
  if (!direct) {
    if (!subscriberId) return NextResponse.json({ error: "اختر المشترك أو فعّل «بيع مباشر»" }, { status: 400 });
    subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
    if (!subscriber || subscriber.isDeleted || !(await ownsTower(g.session, subscriber.towerId))) {
      return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
    }
  }
  const towerId = subscriber?.towerId ?? g.session.towerId ?? null;

  const total = items.reduce((s, it) => s + it.count * it.price, 0);
  const itemsCount = items.reduce((s, it) => s + it.count, 0);

  // أهلية سحب كود المكافأة: مفعّل للمكتب + رصيد للمشترك (لا مكافأة في البيع المباشر)
  let rewardEligible = false;
  if (!direct && subscriber && useReward && (subscriber.rewardBalance ?? 0) > 0) {
    const off = subscriber.towerId ? await prisma.tower.findUnique({ where: { id: subscriber.towerId }, select: { rewardsEnabled: true } }) : null;
    rewardEligible = off?.rewardsEnabled === "1";
  }

  // رقم الفاتورة التسلسلي
  const last = await prisma.invoice.findFirst({
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const number = (last?.number ?? 0) + 1;

  let rewardDiscount = 0;
  const invoice = await prisma.$transaction(async (tx) => {
    // خصم كود المكافأة أولاً (بحدّ الإجمالي، يبقى الباقي للمشترك)
    if (rewardEligible && subscriber) {
      const r = await redeemReward(tx, {
        subscriberId: subscriber.id, billAmount: total, context: "sale", towerId: subscriber.towerId,
        agentId: session?.agentId ?? null, createdByUser: session?.username, createdByName: session?.fullName ?? undefined,
      });
      rewardDiscount = r?.discount ?? 0;
    }
    const netTotal = Math.max(0, total - rewardDiscount); // المستحقّ بعد المكافأة
    const remainder = Math.max(0, netTotal - paid); // الدين على المشترك من هذه الفاتورة

    const buyer = direct ? (customerName?.trim() || "بيع مباشر") : (subscriber?.name ?? subscriber?.id ?? "");
    const inv = await tx.invoice.create({
      data: {
        date: new Date(),
        number,
        itemsCount,
        totalMy: netTotal,
        waselHim: paid,
        note: [
          direct && customerName?.trim() ? `الزبون: ${customerName.trim()}` : "",
          note ?? "",
          rewardDiscount > 0 ? `(مكافأة −${rewardDiscount.toLocaleString("en-US")} من إجمالي ${total.toLocaleString("en-US")})` : "",
        ].filter(Boolean).join(" — ") || null,
        user: session?.username,
        type: direct ? "بيع مباشر" : "بيع",
        subscriberId: subscriber?.id ?? null,
        towerId,
      },
    });

    for (const it of items) {
      await tx.invoiceItem.create({
        data: { invoiceId: inv.id, itemId: it.itemId, count: it.count, price: it.price },
      });
      // إنقاص المخزون
      await tx.item.update({ where: { id: it.itemId }, data: { count: { decrement: it.count } } });
    }

    // تسجيل المبلغ المدفوع كقبض في الصندوق
    if (paid > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: paid, moneyOut: 0,
          notes: `فاتورة بيع #${number} - ${buyer}`,
          date: new Date(), serverDate: new Date(), userId: session?.userId,
          sourceType: "invoice", sourceId: inv.id, towerId,
        },
      });
    }

    // إضافة المتبقّي كدين على المشترك (فواتير بالدين) — البيع المباشر بلا دين (نقدي)
    if (remainder > 0 && subscriber) {
      await tx.subscriber.update({
        where: { id: subscriber.id },
        data: { carry: (subscriber.carry ?? 0) + remainder },
      });
    }

    return inv;
  });

  // رسالة تأكيد استخدام المكافأة (أفضل جهد) — لا تحدث في البيع المباشر
  if (rewardDiscount > 0 && subscriber) {
    const rs = await prisma.subscriber.findUnique({ where: { id: subscriber.id }, select: { phone: true, waEnabled: true, name: true, rewardBalance: true } });
    if (rs) void sendRewardUsedMessage({
      subscriberId: subscriber.id, officeId: subscriber.towerId, agentId: session?.agentId ?? null,
      phone: rs.phone, waEnabled: rs.waEnabled, name: rs.name, discount: rewardDiscount, balance: rs.rewardBalance ?? 0, createdByUser: session?.username,
    });
  }

  return NextResponse.json(invoice, { status: 201 });
}
