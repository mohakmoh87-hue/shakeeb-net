import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  desc: z.string().min(1, "وصف المشكلة مطلوب"),
  typeId: z.coerce.number().nullable().optional(),
  priorityId: z.coerce.number().nullable().optional(),
  statusId: z.coerce.number().nullable().optional(),
  tower: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const g = await guard("tickets.manage");
  if (g.error) return g.error;

  const status = new URL(request.url).searchParams.get("status"); // open | closed | all
  const tickets = await prisma.ticket.findMany({
    where: {
      isDeleted: false,
      ...(status === "open" ? { isClosed: { not: 1 } } : {}),
      ...(status === "closed" ? { isClosed: 1 } : {}),
    },
    orderBy: { id: "desc" },
    take: 300,
  });

  // ربط أسماء المراجع
  const [types, priorities, states] = await Promise.all([
    prisma.ticketType.findMany({ select: { id: true, name: true } }),
    prisma.ticketPriority.findMany({ select: { id: true, name: true } }),
    prisma.ticketState.findMany({ select: { id: true, name: true } }),
  ]);
  const tMap = new Map(types.map((t) => [t.id, t.name]));
  const pMap = new Map(priorities.map((p) => [p.id, p.name]));
  const sMap = new Map(states.map((s) => [s.id, s.name]));

  return NextResponse.json(
    tickets.map((t) => ({
      ...t,
      typeName: t.typeId ? tMap.get(t.typeId) : null,
      priorityName: t.priorityId ? pMap.get(t.priorityId) : null,
      statusName: t.statusId ? sMap.get(t.statusId) : null,
    })),
  );
}

export async function POST(request: Request) {
  const g = await guard("tickets.manage");
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

  const created = await prisma.ticket.create({
    data: {
      ...parsed.data,
      date: new Date(),
      isClosed: 0,
      createdByUser: session?.fullName ?? session?.username,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
