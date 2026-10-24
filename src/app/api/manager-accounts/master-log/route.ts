import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { onlyMaster } from "@/lib/moneyKinds";
import { MASTER_SIGN, totalLogTotal, withRunningBalance, type TotalLogEntry } from "@/lib/totalLog";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  "master-receipt": "قبضُ ماستر",
  "master-expense": "صرفُ ماستر",
};

// اليوم بصيغة YYYY-MM-DD بتوقيت بغداد (UTC+3) — كتجميع التقارير اليوميّة نفسِه
function baghdadDay(d: Date): string {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 💳 حركاتُ «حساب الماستر» — نظيرُ حركات «المبلغ الكلّي الموجود» حرفيّاً (طلبُ محمد
// 2026-10-24: «نفس الشيء بالضبط ولكن للماستر»). قراءةٌ محضةٌ لا تكتب حرفاً.
// مصدرُها معادلةُ رصيد الماستر نفسُها، فلا سطرَ خارجَها ولا مكوّنَ بلا سطر:
//   الماستر = (Σ moneyIn − Σ moneyOut بوسم الماستر) + master-receipt − master-expense
// فأسطرُ «تقرير يوميّ» صافي كلِّ يومٍ من حركات ماستر المكاتب، والباقيةُ حركاتُ ماستر
// المدير مفردةً. و«المبلغ الكلّي» خارجٌ تماماً: `onlyMaster` يحصر الأولى، و`MASTER_SIGN`
// يحصر الثانية — فلا تختلط الدفتران.
// ⚠️ ولا `take` هنا: الرصيدُ يُجمَع من الحركات كلِّها، وقصُّها يُفسد «أصبح» والمجموع.
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1; // عزلُ المستأجر
  const agentTowers = await agentTowerIds(g.session);

  const [officeTxs, rows] = await Promise.all([
    prisma.moneyTx.findMany({
      where: { isDeleted: false, ...onlyMaster, towerId: { in: agentTowers.length ? agentTowers : [-1] } },
      select: { moneyIn: true, moneyOut: true, date: true },
    }),
    prisma.managerTx.findMany({
      where: { isDeleted: false, agentId, type: { in: Object.keys(MASTER_SIGN) } },
      select: { id: true, type: true, amount: true, notes: true, date: true, byUser: true, managerId: true },
      orderBy: { date: "desc" },
    }),
  ]);

  const managers = await prisma.manager.findMany({ where: { agentId, isDeleted: false }, select: { id: true, name: true } });
  const managerName = new Map(managers.map((m) => [m.id, m.name]));

  const byDay = new Map<string, { moneyIn: number; moneyOut: number; count: number }>();
  for (const t of officeTxs) {
    if (!t.date) continue;
    const day = baghdadDay(t.date);
    const cur = byDay.get(day) ?? { moneyIn: 0, moneyOut: 0, count: 0 };
    cur.moneyIn += t.moneyIn ?? 0;
    cur.moneyOut += t.moneyOut ?? 0;
    cur.count += 1;
    byDay.set(day, cur);
  }

  const entries: TotalLogEntry[] = [
    ...[...byDay.entries()].map(([day, a]) => ({
      kind: "daily" as const,
      key: `mday:${day}`,
      at: `${day}T00:00:00.000Z`,
      day,
      label: "تقرير يوميّ",
      amount: a.moneyIn - a.moneyOut,
      sign: (a.moneyIn - a.moneyOut >= 0 ? 1 : -1) as 1 | -1,
      moneyIn: a.moneyIn,
      moneyOut: a.moneyOut,
      count: a.count,
      notes: null,
      byName: null,
    })),
    ...rows.map((r) => ({
      kind: "manager" as const,
      key: `mtx:${r.id}`,
      at: r.date.toISOString(),
      day: null,
      label: LABEL[r.type] ?? r.type,
      type: r.type,
      amount: Math.abs(r.amount),
      sign: MASTER_SIGN[r.type] ?? -1,
      notes: r.notes,
      byName: r.managerId != null ? (managerName.get(r.managerId) ?? null) : (r.byUser ?? null),
      forManager: r.managerId != null,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // حارسٌ حيّ: مجموعُ الحركات = رصيدُ الماستر بمعادلته
  const sum = totalLogTotal(entries);
  const masterBalance =
    officeTxs.reduce((s, t) => s + (t.moneyIn ?? 0) - (t.moneyOut ?? 0), 0) +
    rows.reduce((s, r) => s + (MASTER_SIGN[r.type] ?? -1) * Math.abs(r.amount), 0);

  return NextResponse.json({
    entries: withRunningBalance(entries),
    sum,
    masterBalance,
    balanced: Math.round(sum) === Math.round(masterBalance),
  });
}
