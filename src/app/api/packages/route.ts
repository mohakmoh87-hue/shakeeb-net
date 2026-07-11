import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1, "اسم الباقة مطلوب"),
  priceDollar: z.coerce.number().nullable().optional(),
  priceDinar: z.coerce.number().nullable().optional(),
  addPrice: z.coerce.number().nullable().optional(),
  towerId: z.coerce.number().nullable().optional(),
});

export async function GET() {
  // القراءة متاحة لأي مستخدم (الباقات تُستخدم في التفعيل والكروت والفواتير)
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const packages = await prisma.package.findMany({
    where: { isDeleted: false },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(packages);
}

export async function POST(request: Request) {
  const g = await guard("packages.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const created = await prisma.package.create({ data: parsed.data });
  return NextResponse.json(created, { status: 201 });
}
