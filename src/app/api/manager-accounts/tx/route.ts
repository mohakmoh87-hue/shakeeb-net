import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  type: z.enum(["expense", "receipt", "card-payment", "master-receipt", "master-expense"]),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  notes: z.string().nullable().optional(),
});

// تسجيل حركة في حساب المدير (مصروف/مقبوض/تسديد كارتات) — لا تؤثر على التقرير اليومي
export async function POST(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const session = await getSession();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { type, amount, notes } = parsed.data;

  // حساب الماستر: مستقل تماماً — يُسجَّل كحركة MoneyTx بنوع "master" (لا يدخل بالمجموع)
  if (type === "master-receipt" || type === "master-expense") {
    const isIn = type === "master-receipt";
    const created = await prisma.moneyTx.create({
      data: {
        moneyIn: isIn ? amount : 0, moneyOut: isIn ? 0 : amount,
        notes: notes ?? (isIn ? "قبض ماستر" : "صرف ماستر"),
        date: new Date(), serverDate: new Date(), userId: session?.userId,
        sourceType: "master", towerId: session?.towerId ?? null,
      },
    });
    return NextResponse.json({ ok: true, id: created.id, master: true }, { status: 201 });
  }

  // منع تسديد كارتات أكثر من الدين المتبقّي
  if (type === "card-payment") {
    const [cardsAgg, paid] = await Promise.all([
      prisma.rechargeCard.aggregate({ _sum: { price: true } }),
      prisma.managerTx.aggregate({ where: { isDeleted: false, type: "card-payment" }, _sum: { amount: true } }),
    ]);
    const remaining = (cardsAgg._sum.price ?? 0) - (paid._sum.amount ?? 0);
    if (amount > remaining + 0.001) {
      return NextResponse.json({ error: `المبلغ أكبر من ديون الكارتات المتبقّية (${remaining.toLocaleString("en-US")})` }, { status: 400 });
    }
  }

  const created = await prisma.managerTx.create({
    data: { type, amount, notes: notes ?? null, userId: session?.userId },
  });
  return NextResponse.json(created, { status: 201 });
}

// حذف حركة مدير (عكسي)
export async function DELETE(request: Request) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });
  await prisma.managerTx.updateMany({ where: { id, isDeleted: false }, data: { isDeleted: true } });
  return NextResponse.json({ ok: true });
}
