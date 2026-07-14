import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

const schema = z.object({
  itemId: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  toTowerId: z.coerce.number().int().positive(),
});

// ترحيل مادة من مخزن مكتب إلى مكتب آخر (عند وفرة مادة بمكتب ونفادها بآخر).
// يُنقِص من مخزن المصدر ويزيد في مخزن الوجهة (يُنشئ المادة هناك إن لم توجد).
export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const session = g.session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { itemId, qty, toTowerId } = parsed.data;

  const item = await prisma.item.findFirst({ where: { id: itemId, isDeleted: false } });
  if (!item) return NextResponse.json({ error: "المادة غير موجودة" }, { status: 404 });

  // عزل: مستخدم المكتب يُرحّل من مخزن مكتبه فقط
  if (session && !session.isAdmin && session.towerId != null && item.towerId !== session.towerId) {
    return NextResponse.json({ error: "لا يمكنك الترحيل من مخزن مكتب آخر" }, { status: 403 });
  }
  if (item.towerId === toTowerId) {
    return NextResponse.json({ error: "المكتب المصدر والوجهة متطابقان" }, { status: 400 });
  }
  const dest = await prisma.tower.findFirst({ where: { id: toTowerId, isDeleted: false } });
  if (!dest) return NextResponse.json({ error: "المكتب الوجهة غير موجود" }, { status: 404 });

  // المتوفّر بالمكتب المصدر = الكمية − ما بذمم الفنيين
  const custodyAgg = await prisma.custody.aggregate({ where: { itemId, isDeleted: false }, _sum: { qty: true } });
  const atOffice = (item.count ?? 0) - (custodyAgg._sum.qty ?? 0);
  if (qty > atOffice) {
    return NextResponse.json({ error: `المتوفّر بالمخزن ${atOffice} فقط` }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    // خصم من المصدر
    await tx.item.update({ where: { id: itemId }, data: { count: (item.count ?? 0) - qty } });
    // إضافة للوجهة: مادة بنفس الاسم إن وُجدت، وإلا تُنشأ
    const existing = await tx.item.findFirst({
      where: { name: item.name, towerId: toTowerId, isDeleted: false },
    });
    if (existing) {
      await tx.item.update({ where: { id: existing.id }, data: { count: (existing.count ?? 0) + qty } });
    } else {
      await tx.item.create({
        data: {
          name: item.name, category: item.category, priceDinar: item.priceDinar,
          priceSale: item.priceSale, priceSale2: item.priceSale2, barcode: item.barcode,
          count: qty, towerId: toTowerId,
        },
      });
    }
  });

  return NextResponse.json({ ok: true, moved: qty, to: dest.name });
}
