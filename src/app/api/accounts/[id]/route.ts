import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({
  name: z.string().min(1, "اسم الحساب مطلوب"),
  typeName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isEmployee: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "1"),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("accounts.manage");
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
  const updated = await prisma.account.update({
    where: { id: Number(id) },
    data: parsed.data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("accounts.manage");
  if (g.error) return g.error;

  const { id } = await params;
  await prisma.account.update({
    where: { id: Number(id) },
    data: { isDeleted: true },
  });
  return NextResponse.json({ ok: true });
}
