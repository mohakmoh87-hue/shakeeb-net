import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({
  name: z.string().min(1, "اسم الباقة مطلوب"),
  priceDollar: z.coerce.number().nullable().optional(),
  priceDinar: z.coerce.number().nullable().optional(),
  addPrice: z.coerce.number().nullable().optional(),
  towerId: z.coerce.number().nullable().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("packages.manage");
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

  const updated = await prisma.package.update({
    where: { id: Number(id) },
    data: parsed.data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("packages.manage");
  if (g.error) return g.error;

  const { id } = await params;
  await prisma.package.update({
    where: { id: Number(id) },
    data: { isDeleted: true }, // حذف منطقي
  });
  return NextResponse.json({ ok: true });
}
