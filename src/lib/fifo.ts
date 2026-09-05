// ═════ 🏬📦 استهلاكُ دفعات المخزن بنظام FIFO عند البيع — طلب محمد 2026-09-05 ═════
// البيعُ يخصم من أقدمِ دفعةٍ فالأحدث، ويسجّل الكلفةَ الفعليّة لكلّ قطعةٍ في SaleConsumption
// (لا المتوسّط) — به يُحسَب ربحُ المبيعات، ويُستعاد المخزونُ للدفعة نفسِها عند إلغاء الفاتورة.
import { Prisma } from "@prisma/client";

type ConsumeArgs = {
  agentId: number; towerId: number | null; itemId: number; qty: number; unitSell: number;
  invoiceId: number | null; invoiceItemId: number; sellerUserId: number | null; at: Date;
};

/** يستهلك qty من دفعات المادة (الأقدم أوّلاً)، يكتب دفتر الاستهلاك، ويعيد متوسّطَ الكلفة الفعليّة للعرض. */
export async function consumeFifo(tx: Prisma.TransactionClient, a: ConsumeArgs): Promise<number> {
  let need = a.qty;
  let costSum = 0;
  if (need <= 0) return 0;
  const batches = await tx.itemBatch.findMany({
    where: { itemId: a.itemId, isDeleted: false, remaining: { gt: 0 } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  for (const bt of batches) {
    if (need <= 0) break;
    const take = Math.min(need, bt.remaining);
    if (take <= 0) continue;
    // خصمٌ ذرّيّ (لا كتابةُ قيمةٍ مطلقةٍ قديمة) — كي لا يضيع استرجاعُ إلغاءٍ متزامن
    await tx.itemBatch.update({ where: { id: bt.id }, data: { remaining: { decrement: take } } });
    await tx.saleConsumption.create({
      data: { agentId: a.agentId, towerId: a.towerId, sellerUserId: a.sellerUserId, invoiceId: a.invoiceId, invoiceItemId: a.invoiceItemId, itemId: a.itemId, batchId: bt.id, qty: take, unitCost: bt.buyPrice, unitSell: a.unitSell, at: a.at },
    });
    costSum += take * bt.buyPrice;
    need -= take;
  }
  if (need > 0) {
    // نقصُ دفعات (مخزونٌ قديمٌ سابقٌ لـFIFO لم يُهجَّر) ⇒ دفعةٌ افتتاحيّةٌ اصطناعيّةٌ بكلفة المتوسّط الحاليّ
    const item = await tx.item.findUnique({ where: { id: a.itemId }, select: { priceDinar: true } });
    const cost = Number(item?.priceDinar ?? 0);
    const bt = await tx.itemBatch.create({
      data: { agentId: a.agentId, towerId: a.towerId ?? 0, itemId: a.itemId, receiptId: null, buyPrice: cost, sellPrice: null, qty: need, remaining: 0, date: new Date(0) },
      select: { id: true },
    });
    await tx.saleConsumption.create({
      data: { agentId: a.agentId, towerId: a.towerId, sellerUserId: a.sellerUserId, invoiceId: a.invoiceId, invoiceItemId: a.invoiceItemId, itemId: a.itemId, batchId: bt.id, qty: need, unitCost: cost, unitSell: a.unitSell, at: a.at },
    });
    costSum += need * cost;
  }
  return a.qty > 0 ? Math.round(costSum / a.qty) : 0;
}

/** إلغاءُ فاتورة: يعيد المستهلَكَ لكلّ دفعةٍ نفسِها ويشطب دفتر الاستهلاك. يعيد عددَ الصفوف المُعادة. */
export async function restoreFifo(tx: Prisma.TransactionClient, invoiceItemId: number): Promise<number> {
  const cons = await tx.saleConsumption.findMany({ where: { invoiceItemId, isDeleted: false }, select: { id: true, batchId: true, qty: true } });
  for (const c of cons) {
    await tx.itemBatch.update({ where: { id: c.batchId }, data: { remaining: { increment: c.qty } } }).catch(() => {});
    await tx.saleConsumption.update({ where: { id: c.id }, data: { isDeleted: true } });
  }
  return cons.length;
}
