import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getOrCreatePettyAccount } from "@/lib/field";

export const dynamic = "force-dynamic";

const schema = z.object({
  cardId: z.coerce.number().int().positive(),
  serviceDetails: z.string().optional(),
  amount: z.coerce.number().min(0).optional(),
  photo: z.string().optional(), // data URL (JPEG مضغوط)
  materials: z
    .array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number().positive() }))
    .optional()
    .default([]),
});

// إنجاز بطاقة — بحقولها الواجبة حسب النوع:
//  • صيانة: تفاصيل + مبلغ + صورة (المواد اختيارية).
//  • توصيل: مبلغ فقط.
// منطق المواد: تُباع من المخزن (تُضاف للمبيعات)، وتُخصم من ذمّة الفني. والمبلغ يُقسَّم:
// جزء بقيمة المواد المباعة (مبيعات)، والباقي مقبوض في حساب "نثرية". وإن كان المبلغ
// أقل من قيمة المواد فكامله يُسجَّل للمبيعات فقط.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { cardId, serviceDetails, amount, photo, materials } = parsed.data;

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة مسبقاً" }, { status: 400 });
  if (card.technicianId == null) {
    return NextResponse.json({ error: "يجب توجيه البطاقة لفني قبل إنجازها" }, { status: 400 });
  }

  const isDelivery = card.kind === "delivery";

  // التحقّق من الحقول الواجبة
  if (amount == null || amount <= 0) {
    return NextResponse.json({ error: "المبلغ مطلوب" }, { status: 400 });
  }
  if (!isDelivery) {
    if (!serviceDetails?.trim()) return NextResponse.json({ error: "تفاصيل الصيانة مطلوبة" }, { status: 400 });
    if (!photo?.trim()) return NextResponse.json({ error: "رفع صورة مطلوب" }, { status: 400 });
  }

  // مكتب الفني (لعزل المبيعات/النثرية)
  const tech = await prisma.technician.findUnique({ where: { id: card.technicianId } });
  const towerId = tech?.towerId ?? null;

  // ===== معالجة المواد (للصيانة فقط؛ التوصيل بلا مواد) =====
  const soldInfo: { itemId: number; name: string; qty: number; price: number }[] = [];
  let materialsTotal = 0;
  if (!isDelivery && materials.length > 0) {
    for (const m of materials) {
      const item = await prisma.item.findFirst({ where: { id: m.itemId, isDeleted: false } });
      if (!item) return NextResponse.json({ error: `مادة #${m.itemId} غير موجودة` }, { status: 404 });
      const custody = await prisma.custody.findFirst({
        where: { technicianId: card.technicianId, itemId: m.itemId, isDeleted: false },
      });
      if (!custody || custody.qty < m.qty) {
        return NextResponse.json({ error: `الكمية بذمّة الفني من «${item.name}» غير كافية` }, { status: 400 });
      }
      const price = item.priceSale ?? 0;
      materialsTotal += price * m.qty;
      soldInfo.push({ itemId: item.id, name: item.name ?? "مادة", qty: m.qty, price });
    }
  }

  // تقسيم المبلغ: ما يخصّ المواد (مبيعات) والباقي (نثرية)
  const salesShare = materials.length > 0 ? Math.min(amount, materialsTotal) : 0;
  const pettyShare = amount - salesShare; // الباقي (قد يكون كامل المبلغ إن لا مواد)

  const petty = pettyShare > 0 ? await getOrCreatePettyAccount(towerId) : null;

  await prisma.$transaction(async (tx) => {
    // خصم المواد من المخزن ومن ذمّة الفني
    for (const s of soldInfo) {
      const item = await tx.item.findUnique({ where: { id: s.itemId } });
      await tx.item.update({ where: { id: s.itemId }, data: { count: (item?.count ?? 0) - s.qty } });
      const custody = await tx.custody.findFirst({
        where: { technicianId: card.technicianId!, itemId: s.itemId, isDeleted: false },
      });
      if (custody) await tx.custody.update({ where: { id: custody.id }, data: { qty: custody.qty - s.qty } });
    }
    // قيد المبيعات (حصّة المواد)
    if (salesShare > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: salesShare, moneyOut: 0, date: new Date(), serverDate: new Date(),
          userId: session.userId, sourceType: "sale", sourceId: cardId, towerId,
          notes: `مبيع ذمم — تكت #${cardId}: ` + soldInfo.map((s) => `${s.name}×${s.qty}`).join("، "),
        },
      });
    }
    // قيد النثرية (الباقي)
    if (petty && pettyShare > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: pettyShare, moneyOut: 0, date: new Date(), serverDate: new Date(),
          userId: session.userId, accountId: petty.id, sourceType: "manual", towerId,
          notes: `نثرية — ${isDelivery ? "توصيل" : "صيانة"} تكت #${cardId}`,
        },
      });
    }
    // حفظ الصورة (تُحذف مع البطاقة/التحصيل)
    if (photo?.trim()) {
      await tx.cardPhoto.upsert({
        where: { cardId }, update: { data: photo }, create: { cardId, data: photo },
      });
    }
    // إنجاز البطاقة (تبقى معلّقة حتى التحصيل)
    await tx.taskCard.update({
      where: { id: cardId },
      data: {
        done: true, completedAt: new Date(),
        amount, serviceDetails: serviceDetails?.trim() || null,
        materialsInfo: soldInfo.length ? JSON.stringify(soldInfo) : null,
      },
    });
  });

  return NextResponse.json({ ok: true, salesShare, pettyShare, hasPhoto: !!photo });
}
