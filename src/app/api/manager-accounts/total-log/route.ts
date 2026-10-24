import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { dailyLogData } from "@/lib/dailyLogAgg";
import { managerBalances } from "@/lib/managerBalances";
import { TOTAL_SIGN, totalLogTotal, type TotalLogEntry } from "@/lib/totalLog";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  receipt: "قبضُ الإدارة",
  expense: "صرفُ الإدارة",
  "card-payment": "تسديدُ ديون الكارتات",
  salary: "راتبٌ من المبلغ الكلّي",
};

// 💰 حركاتُ «المبلغ الكلّي الموجود» — قراءةٌ محضةٌ لا تكتب حرفاً (طلبُ محمد 2026-10-24).
// مصدرُها معادلةُ الرصيد نفسُها في `managerBalances`، فلا سطرَ خارجَها ولا مكوّنَ بلا سطر:
//   الكلّي = صافي التقارير اليوميّة − card-payment − expense − salary + receipt
// فأسطرُ «تقرير يوميّ» من `dailyLogAgg` (نفسُ تجميع بطاقة التقارير حرفيّاً، فتفصيلُ اليوم
// يُفتَح كما يُفتَح هناك)، والأربعةُ الباقية من `managerTx`. والماستر خارجٌ تماماً:
// `master-receipt`/`master-expense` ليسا في المعادلة، و`moneyTx` يستثنيه بـ`notMaster`.
// وشقُّ نقل الصندوق يظهر من نفسِه — فهو `expense`/`receipt` بملاحظةٍ تحمل «⇄ نقل … الصندوق».
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1; // عزلُ المستأجر
  const agentTowers = await agentTowerIds(g.session);

  const [daily, rows, balances, managers] = await Promise.all([
    dailyLogData(agentTowers),
    prisma.managerTx.findMany({
      where: { isDeleted: false, agentId, type: { in: Object.keys(TOTAL_SIGN) } },
      select: { id: true, type: true, amount: true, notes: true, date: true, byUser: true, managerId: true },
      orderBy: { date: "desc" },
    }),
    managerBalances(agentId, agentTowers),
    prisma.manager.findMany({ where: { agentId, isDeleted: false }, select: { id: true, name: true } }),
  ]);

  const managerName = new Map(managers.map((m) => [m.id, m.name]));

  const entries: TotalLogEntry[] = [
    ...daily.days.map((d) => ({
      kind: "daily" as const,
      key: `daily:${d.day}`,
      at: `${d.day}T00:00:00.000Z`,
      day: d.day,
      label: "تقرير يوميّ",
      amount: d.net,
      sign: (d.net >= 0 ? 1 : -1) as 1 | -1,
      moneyIn: d.moneyIn,
      moneyOut: d.moneyOut,
      count: d.count,
      notes: null,
      byName: null,
    })),
    ...rows.map((r) => ({
      kind: "manager" as const,
      key: `tx:${r.id}`,
      at: r.date.toISOString(),
      day: null,
      label: LABEL[r.type] ?? r.type,
      type: r.type,
      amount: Math.abs(r.amount),
      sign: TOTAL_SIGN[r.type] ?? -1,
      notes: r.notes,
      byName: r.managerId != null ? (managerName.get(r.managerId) ?? null) : (r.byUser ?? null),
      forManager: r.managerId != null,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // حارسٌ حيّ: مجموعُ الحركات بإشاراتها يجب أن يساوي الرصيدَ المعروض بالمعادلة.
  const sum = totalLogTotal(entries);
  return NextResponse.json({
    entries,
    sum,
    totalAvailable: balances.totalAvailable,
    balanced: Math.round(sum) === Math.round(balances.totalAvailable),
    offices: daily.offices,
    separatedOffices: daily.separatedOffices,
    dayByOffice: Object.fromEntries(daily.days.map((d) => [d.day, d.byOffice])),
    dayByUser: Object.fromEntries(daily.days.map((d) => [d.day, d.byUser])),
  });
}
