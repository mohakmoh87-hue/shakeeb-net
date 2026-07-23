import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

const schema = z.object({
  itemId: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  price: z.coerce.number().min(0, "السعر غير صحيح"), // سعر البيع (قابل للتعديل أثناء البيع)
  received: z.coerce.number().min(0).default(0), // المبلغ الواصل
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
  const { itemId, qty, price, received } = parsed.data;

  const item = await prisma.item.findFirst({ where: { id: itemId, isDeleted: false } });
  if (!item) return NextResponse.json({ error: "المادة غير موجودة" }, { status: 404 });

  // عزل المكاتب والوكلاء: مستخدم المكتب يبيع من مخزن مكتبه فقط، والمدير من مخازن
  // مكاتب وكيله فقط (كان الأدمن يستطيع البيع من مادة أي وكيل بالمعرّف)
  if (session && !session.isAdmin && session.towerId != null && item.towerId !== session.towerId) {
    return NextResponse.json({ error: "لا يمكنك البيع من مخزن مكتب آخر" }, { status: 403 });
  }
  if (item.towerId != null && !(await ownsTower(session, item.towerId))) {
    return NextResponse.json({ error: "المادة لا تتبع حسابك" }, { status: 403 });
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
  const remaining = Math.max(0, total - received);

  const [, tx] = await prisma.$transaction([
    prisma.item.update({ where: { id: itemId }, data: { count: (item.count ?? 0) - qty } }),
    prisma.moneyTx.create({
      data: {
        moneyIn: received, moneyOut: 0, date: new Date(), serverDate: new Date(),
        userId: session?.userId, sourceType: "sale", sourceId: itemId, towerId: item.towerId ?? null,
        notes: `بيع ${item.name ?? "مادة"} × ${qty} بسعر ${price.toLocaleString("en-US")}` +
          (remaining > 0 ? ` (واصل ${received.toLocaleString("en-US")}، متبقّي ${remaining.toLocaleString("en-US")})` : ""),
      },
    }),
  ]);

  return NextResponse.json({ ok: true, txId: tx.id, total, received, remaining });
}
