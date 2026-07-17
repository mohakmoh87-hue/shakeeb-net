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

  const upd = await prisma.package.updateMany({
    where: { id: Number(id), agentId: g.session?.agentId ?? -1 }, // عزل: باقة وكيل المستخدم
    data: parsed.data,
  });
  if (upd.count === 0) return NextResponse.json({ error: "الباقة غير موجودة ضمن حسابك" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("packages.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const del = await prisma.package.updateMany({
    where: { id: Number(id), agentId: g.session?.agentId ?? -1 }, // عزل: باقة وكيل المستخدم
    data: { isDeleted: true }, // حذف منطقي
  });
  if (del.count === 0) return NextResponse.json({ error: "الباقة غير موجودة ضمن حسابك" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
