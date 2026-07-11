import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// اليوم بصيغة YYYY-MM-DD بتوقيت بغداد (UTC+3)
function baghdadDay(d: Date): string {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// سجل "مجموع المبالغ اليومية": كل حركات الصندوق مجمّعة حسب اليوم (بتوقيت بغداد).
// يمثّل ما يُضاف للمجموع كل يوم عند التقرير اليومي — كل سطر بتاريخه وصافي مبلغه.
// مجموع صافي كل الأيام = مجموع المبالغ اليومية المعروض في البطاقة.
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  const txs = await prisma.moneyTx.findMany({
    where: { isDeleted: false },
    select: { moneyIn: true, moneyOut: true, date: true },
    orderBy: { date: "asc" },
  });

  const map = new Map<string, { day: string; moneyIn: number; moneyOut: number; count: number }>();
  for (const t of txs) {
    if (!t.date) continue;
    const day = baghdadDay(t.date);
    const row = map.get(day) ?? { day, moneyIn: 0, moneyOut: 0, count: 0 };
    row.moneyIn += t.moneyIn ?? 0;
    row.moneyOut += t.moneyOut ?? 0;
    row.count += 1;
    map.set(day, row);
  }

  // الأحدث أولاً
  const days = [...map.values()]
    .map((r) => ({ ...r, net: r.moneyIn - r.moneyOut }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));

  const total = days.reduce((s, d) => s + d.net, 0);
  return NextResponse.json({ days, total });
}
