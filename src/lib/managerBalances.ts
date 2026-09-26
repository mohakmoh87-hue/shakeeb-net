import { prisma } from "@/lib/prisma";
import { notMaster } from "@/lib/moneyKinds";

// ═════ رصيدا «المبلغ الكلّي» و«الصندوق» — معادلةٌ واحدةٌ لكلّ من يحتاجها ═════
// صفحةُ حسابات المدير تعرضهما، ومسارُ النقل يحرس بهما («امنع نقلَ المبلغ الأكبر
// للطرفين» — قرارُ محمد 2026-09-27). فلو نُسخت المعادلةُ في المسارَين لاختلف المعروضُ
// عن المحروس عند أوّل تعديل — وهو عينُ درس و-٢ في عكس الفواتير.
export async function managerBalances(agentId: number, towerIds: number[]): Promise<{ totalAvailable: number; vaultBalance: number }> {
  const [dailyAgg, mgr] = await Promise.all([
    prisma.moneyTx.aggregate({
      where: { isDeleted: false, towerId: { in: towerIds.length ? towerIds : [-1] }, ...notMaster },
      _sum: { moneyIn: true, moneyOut: true },
    }),
    prisma.managerTx.groupBy({ by: ["type"], where: { isDeleted: false, agentId }, _sum: { amount: true } }),
  ]);
  const sumBy = (t: string) => mgr.find((m) => m.type === t)?._sum.amount ?? 0;
  const cumulativeDaily = (dailyAgg._sum.moneyIn ?? 0) - (dailyAgg._sum.moneyOut ?? 0);
  const totalAvailable =
    cumulativeDaily - sumBy("card-payment") - sumBy("expense") - sumBy("salary") + sumBy("receipt");
  const vaultBalance = sumBy("vault-receipt") - sumBy("vault-expense");
  return { totalAvailable, vaultBalance };
}
