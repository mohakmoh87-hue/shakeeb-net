import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

const schema = z.object({
  name: z.string().min(1, "اسم المادة مطلوب"),
  category: z.string().nullable().optional(),
  priceSale: z.coerce.number().nullable().optional(),
  priceSale2: z.coerce.number().nullable().optional(),
  priceDinar: z.coerce.number().nullable().optional(),
  count: z.coerce.number().nullable().optional(),
  barcode: z.string().nullable().optional(),
  towerId: z.coerce.number().nullable().optional(), // للمدير: اختيار مكتب المخزن
});

export async function GET() {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  // مخزن مستقل لكل مكتب؛ المدير يرى كل المكاتب
  const items = await prisma.item.findMany({
    where: { isDeleted: false, ...towerScope(g.session) },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(items);
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
  // مستخدم المكتب: يُفرض مكتبه دائماً؛ المدير: يختار المكتب من الجسم (أو بلا مكتب)
  const towerId =
    g.session && !g.session.isAdmin && g.session.towerId != null
      ? g.session.towerId
      : parsed.data.towerId ?? null;
  const created = await prisma.item.create({ data: { ...parsed.data, towerId } });
  return NextResponse.json(created, { status: 201 });
}
