import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({
  number: z.string().min(1, "رقم الكرت مطلوب"),
  password: z.string().nullable().optional(),
  serial: z.string().nullable().optional(),
});

export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const cards = await prisma.rechargeCard.findMany({
    orderBy: { id: "desc" },
    take: 500,
  });
  return NextResponse.json(cards);
}

export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const created = await prisma.rechargeCard.create({
    data: { ...parsed.data, addDate: new Date() },
  });
  return NextResponse.json(created, { status: 201 });
}
