import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// تفاصيل حساب الماستر — الحركات مجمّعة حسب اليوم (تفعيلات ماستر + قبض/صرف ماستر).
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  const txs = await prisma.moneyTx.findMany({
    where: { isDeleted: false, sourceType: "master" },
    orderBy: { date: "desc" },
    take: 500,
    select: { id: true, moneyIn: true, moneyOut: true, notes: true, date: true },
  });

  // تجميع يومي (بتوقيت بغداد UTC+3)
  const byDay = new Map<string, { day: string; in: number; out: number; count: number }>();
  for (const t of txs) {
    const d = new Date((t.date ?? new Date()).getTime() + 3 * 60 * 60 * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const cur = byDay.get(key) ?? { day: key, in: 0, out: 0, count: 0 };
    cur.in += t.moneyIn ?? 0; cur.out += t.moneyOut ?? 0; cur.count += 1;
    byDay.set(key, cur);
  }
  const days = [...byDay.values()].map((x) => ({ ...x, net: x.in - x.out }));
  const balance = days.reduce((s, x) => s + x.net, 0);

  return NextResponse.json({ balance, days, transactions: txs });
}
