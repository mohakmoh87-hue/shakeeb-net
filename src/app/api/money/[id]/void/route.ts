import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// حذف حركة مالية عكسياً من الصندوق.
// تسديد دين → يُرجَع الدين للمشترك. حركة يدوية → تُحذف فقط.
// حركة تفعيل/فاتورة → تُحذف من صفحة الوصولات/الفواتير (لإرجاع الأيام/المخزون كاملاً).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("receipts.void");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const txId = Number(id);

  const tx = await prisma.moneyTx.findUnique({ where: { id: txId } });
  if (!tx || tx.isDeleted || !ownsTower(g.session, tx.towerId)) {
    return NextResponse.json({ error: "الحركة غير موجودة أو محذوفة مسبقاً" }, { status: 404 });
  }

  try {
    await prisma.$transaction(async (t) => {
      // ===== حركة تفعيل: إرجاع كامل (أيام + كارت + دين) ثم حذف الوصل =====
      if (tx.sourceType === "activation" && tx.sourceId) {
        const entry = await t.subscriptionEntry.findUnique({ where: { id: tx.sourceId } });
        if (entry && !entry.isDeleted) {
          if (entry.subscriberId) {
            const sub = await t.subscriber.findUnique({ where: { id: entry.subscriberId } });
            if (sub) {
              const debtAdded = (entry.money ?? 0) + (entry.addPrice ?? 0) - (entry.moneyIn ?? 0);
              const restoredDateTo = entry.dateFrom && entry.dateFrom > new Date() ? entry.dateFrom : null;
              await t.subscriber.update({
                where: { id: sub.id },
                data: { dateTo: restoredDateTo, carry: (sub.carry ?? 0) - debtAdded },
              });
            }
          }
          // إرجاع الكارت للمخزون
          if (entry.card2 && entry.subscriberId) {
            await t.rechargeCard.updateMany({
              where: { serial: entry.card2, subscriberId: entry.subscriberId, useDate: { not: null } },
              data: { useDate: null, subscriberId: null, userName: null },
            });
          }
          await t.subscriptionEntry.update({ where: { id: entry.id }, data: { isDeleted: true } });
        }
      }

      // ===== حركة فاتورة: حذف الفاتورة (وتُزال من التقارير) =====
      if (tx.sourceType === "invoice" && tx.sourceId) {
        await t.invoice.updateMany({ where: { id: tx.sourceId, isDeleted: false }, data: { isDeleted: true } });
      }

      // ===== تسديد دين: أرجِع المبلغ ديناً على المشترك =====
      if (tx.sourceType === "debt" && tx.sourceId) {
        const sub = await t.subscriber.findUnique({ where: { id: tx.sourceId } });
        if (sub) {
          await t.subscriber.update({ where: { id: sub.id }, data: { carry: (sub.carry ?? 0) + (tx.moneyIn ?? 0) } });
        }
      }

      // ===== حذف الحركة نفسها (يشمل: بيع، ماستر، نثرية، يدوية) =====
      await t.moneyTx.update({ where: { id: txId }, data: { isDeleted: true } });
      await t.auditLog.create({
        data: {
          userId: session?.userId, action: "VOID_MONEY", entity: "moneyTx", entityId: String(txId),
          details: `حذف حركة (${tx.sourceType ?? "يدوية"}) - قبض ${tx.moneyIn ?? 0} - صرف ${tx.moneyOut ?? 0}`,
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف الحركة" }, { status: 500 });
  }
}
