import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// تفاصيل حساب الماستر — الحركات مجمّعة حسب اليوم (تفعيلات ماستر + قبض/صرف ماستر).
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  // عزل المستأجر: ماستر مكاتب وكيل المستخدم فقط
  const agentTowers = await agentTowerIds(g.session);
  const txs = await prisma.moneyTx.findMany({
    where: { isDeleted: false, sourceType: "master", towerId: { in: agentTowers.length ? agentTowers : [-1] } },
    orderBy: { date: "desc" },
    take: 500,
    select: { id: true, moneyIn: true, moneyOut: true, notes: true, date: true, towerId: true },
  });
  const offices = await prisma.tower.findMany({ where: { id: { in: agentTowers.length ? agentTowers : [-1] } }, select: { id: true, name: true } });
  const officeName = new Map(offices.map((o) => [o.id, o.name ?? `مكتب ${o.id}`]));

  // تجميع يومي (بتوقيت بغداد UTC+3) + تفصيل ماستر كل مكتب داخل اليوم (لا المجموع فقط)
  type DayAgg = { day: string; in: number; out: number; count: number; byOffice: Map<number, number> };
  const byDay = new Map<string, DayAgg>();
  for (const t of txs) {
    const d = new Date((t.date ?? new Date()).getTime() + 3 * 60 * 60 * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const cur = byDay.get(key) ?? { day: key, in: 0, out: 0, count: 0, byOffice: new Map<number, number>() };
    const net = (t.moneyIn ?? 0) - (t.moneyOut ?? 0);
    cur.in += t.moneyIn ?? 0; cur.out += t.moneyOut ?? 0; cur.count += 1;
    if (t.towerId != null) cur.byOffice.set(t.towerId, (cur.byOffice.get(t.towerId) ?? 0) + net);
    byDay.set(key, cur);
  }
  const days = [...byDay.values()].map((x) => ({
    day: x.day, in: x.in, out: x.out, count: x.count, net: x.in - x.out,
    offices: [...x.byOffice.entries()].map(([tid, net]) => ({ towerId: tid, name: officeName.get(tid) ?? `#${tid}`, net })),
  }));
  const balance = days.reduce((s, x) => s + x.net, 0);

  return NextResponse.json({ balance, days, transactions: txs });
}
