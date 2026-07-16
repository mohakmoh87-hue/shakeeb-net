import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  subscriberId: z.coerce.number({ error: "اختر المشترك" }), // إلزامي
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
});

export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const invoices = await prisma.invoice.findMany({
    where: { isDeleted: false },
    orderBy: { id: "desc" },
    take: 200,
  });
  return NextResponse.json(invoices);
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
  const { subscriberId, items, note, paid } = parsed.data;

  // المشترك إلزامي (لمعرفة صاحب الدين والمكتب)
  const subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!subscriber || subscriber.isDeleted || !(await ownsTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  const total = items.reduce((s, it) => s + it.count * it.price, 0);
  const itemsCount = items.reduce((s, it) => s + it.count, 0);
  const remainder = Math.max(0, total - paid); // الدين على المشترك من هذه الفاتورة

  // رقم الفاتورة التسلسلي
  const last = await prisma.invoice.findFirst({
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const number = (last?.number ?? 0) + 1;

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        date: new Date(),
        number,
        itemsCount,
        totalMy: total,
        waselHim: paid,
        note: note ?? null,
        user: session?.username,
        type: "بيع",
        subscriberId,
        towerId: subscriber.towerId,
      },
    });

    for (const it of items) {
      await tx.invoiceItem.create({
        data: {
          invoiceId: inv.id,
          itemId: it.itemId,
          count: it.count,
          price: it.price,
        },
      });
      // إنقاص المخزون
      await tx.item.update({
        where: { id: it.itemId },
        data: { count: { decrement: it.count } },
      });
    }

    // تسجيل المبلغ المدفوع كقبض في الصندوق
    if (paid > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: paid,
          moneyOut: 0,
          notes: `فاتورة بيع #${number} - ${subscriber.name ?? subscriberId}`,
          date: new Date(),
          serverDate: new Date(),
          userId: session?.userId,
          sourceType: "invoice", sourceId: inv.id, towerId: subscriber.towerId,
        },
      });
    }

    // إضافة المتبقّي كدين على المشترك (فواتير بالدين)
    if (remainder > 0) {
      await tx.subscriber.update({
        where: { id: subscriberId },
        data: { carry: (subscriber.carry ?? 0) + remainder },
      });
    }

    return inv;
  });

  return NextResponse.json(invoice, { status: 201 });
}
