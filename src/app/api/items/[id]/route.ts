import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";

const schema = z.object({
  name: z.string().min(1, "اسم المادة مطلوب"),
  category: z.string().nullable().optional(),
  priceSale: z.coerce.number().nullable().optional(),
  priceSale2: z.coerce.number().nullable().optional(),
  priceDinar: z.coerce.number().nullable().optional(),
  count: z.coerce.number().nullable().optional(),
  barcode: z.string().nullable().optional(),
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
  // منع تعديل مادة مكتب آخر
  const existing = await prisma.item.findUnique({ where: { id: Number(id) }, select: { towerId: true } });
  if (!existing || !ownsTower(g.session, existing.towerId)) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }
  const updated = await prisma.item.update({
    where: { id: Number(id) },
    data: parsed.data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const existing = await prisma.item.findUnique({ where: { id: Number(id) }, select: { towerId: true } });
  if (!existing || !ownsTower(g.session, existing.towerId)) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }
  await prisma.item.update({
    where: { id: Number(id) },
    data: { isDeleted: true },
  });
  return NextResponse.json({ ok: true });
}
