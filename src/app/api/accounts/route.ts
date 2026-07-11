import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, guardAny, towerScope } from "@/lib/guard";

const schema = z.object({
  name: z.string().min(1, "اسم الحساب مطلوب"),
  typeName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isEmployee: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "1"),
  towerId: z.coerce.number().nullable().optional(), // للمدير: اختيار مكتب الحساب
});

export async function GET() {
  // القراءة متاحة لمن يدير الحسابات أو المالية (لقائمة الحسابات في الصندوق)
  const g = await guardAny("accounts.manage", "finance.view", "finance.manage");
  if (g.error) return g.error;

  // قائمة حسابات مستقلة لكل مكتب؛ المدير يرى كل المكاتب
  const accounts = await prisma.account.findMany({
    where: { isDeleted: false, ...towerScope(g.session) },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(accounts);
}

export async function POST(request: Request) {
  const g = await guard("accounts.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  // مستخدم المكتب: يُفرض مكتبه؛ المدير: يختار المكتب من الجسم
  const towerId =
    g.session && !g.session.isAdmin && g.session.towerId != null
      ? g.session.towerId
      : parsed.data.towerId ?? null;
  const created = await prisma.account.create({ data: { ...parsed.data, towerId } });
  return NextResponse.json(created, { status: 201 });
}
