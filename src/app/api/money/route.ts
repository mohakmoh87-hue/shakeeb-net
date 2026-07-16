import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  type: z.enum(["in", "out"]), // قبض / صرف
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  accountId: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  date: z.string().optional(),
});

export async function GET(request: Request) {
  const g = await guard("finance.view");
  if (g.error) return g.error;

  const accountId = new URL(request.url).searchParams.get("accountId");
  // صفحة الصندوق للحركات اليدوية فقط (المصروفات والمقبوضات) — التفعيلات/الفواتير تُدار من صفحاتها
  const where = {
    isDeleted: false,
    OR: [{ sourceType: null }, { sourceType: "manual" }],
    ...(await towerScope(g.session)),
    ...(accountId ? { accountId: Number(accountId) } : {}),
  };

  const [transactions, agg, accounts] = await Promise.all([
    prisma.moneyTx.findMany({ where, orderBy: { id: "desc" }, take: 200 }),
    prisma.moneyTx.aggregate({
      where,
      _sum: { moneyIn: true, moneyOut: true },
    }),
    prisma.account.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true },
    }),
  ]);

  const nameMap = new Map(accounts.map((a) => [a.id, a.name]));
  const totalIn = agg._sum.moneyIn ?? 0;
  const totalOut = agg._sum.moneyOut ?? 0;

  return NextResponse.json({
    transactions: transactions.map((t) => ({
      ...t,
      accountName: t.accountId ? nameMap.get(t.accountId) ?? null : null,
    })),
    summary: { totalIn, totalOut, balance: totalIn - totalOut },
  });
}

export async function POST(request: Request) {
  const g = await guard("finance.manage");
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
  const { type, amount, accountId, notes, date } = parsed.data;

  const created = await prisma.moneyTx.create({
    data: {
      moneyIn: type === "in" ? amount : 0,
      moneyOut: type === "out" ? amount : 0,
      accountId: accountId ?? null,
      notes: notes ?? null,
      date: date ? new Date(date) : new Date(),
      userId: session?.userId,
      serverDate: new Date(),
      sourceType: "manual", towerId: session?.towerId ?? null,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
