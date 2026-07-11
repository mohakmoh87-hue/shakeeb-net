import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  desc: z.string().min(1).optional(),
  typeId: z.coerce.number().nullable().optional(),
  priorityId: z.coerce.number().nullable().optional(),
  statusId: z.coerce.number().nullable().optional(),
  tower: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  close: z.boolean().optional(), // إغلاق التذكرة
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("tickets.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { close, ...rest } = parsed.data;

  const updated = await prisma.ticket.update({
    where: { id: Number(id) },
    data: {
      ...rest,
      ...(close
        ? {
            isClosed: 1,
            dateClose: new Date(),
            closedByUser: session?.fullName ?? session?.username,
          }
        : {}),
      ...(close === false ? { isClosed: 0, dateClose: null } : {}),
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("tickets.manage");
  if (g.error) return g.error;

  const { id } = await params;
  await prisma.ticket.update({
    where: { id: Number(id) },
    data: { isDeleted: true },
  });
  return NextResponse.json({ ok: true });
}
