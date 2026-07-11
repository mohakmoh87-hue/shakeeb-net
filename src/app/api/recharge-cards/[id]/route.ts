import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({
  number: z.string().min(1, "رقم الكرت مطلوب"),
  password: z.string().nullable().optional(),
  serial: z.string().nullable().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const updated = await prisma.rechargeCard.update({
    where: { id: Number(id) },
    data: parsed.data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // حذف كارت من المخزن نهائياً (صلاحية cards.delete). يُحذف من قاعدة البيانات كأنه
  // لم يُضف، فينقص مبلغه تلقائياً من ديون الكارتات. يُسمح بحذف غير المستخدمة فقط.
  const g = await guard("cards.delete");
  if (g.error) return g.error;

  const { id } = await params;
  const card = await prisma.rechargeCard.findUnique({ where: { id: Number(id) }, select: { useDate: true } });
  if (!card) return NextResponse.json({ error: "الكارت غير موجود" }, { status: 404 });
  if (card.useDate) return NextResponse.json({ error: "لا يمكن حذف كارت مستخدم" }, { status: 400 });

  await prisma.rechargeCard.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
