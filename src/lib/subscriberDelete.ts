import { prisma } from "@/lib/prisma";

// حذف نهائي لمشترك/مشتركين مع كل سجلاتهم (كأنهم لم يُضافوا أبداً):
// أوصال التفعيل + الفواتير وبنودها + حركات الصندوق المرتبطة + الرسائل + المشترك نفسه.
// إن أُعيد استيراد المشترك لاحقاً يُعتبر مشتركاً جديداً.
export async function purgeSubscribers(ids: number[]): Promise<{ deleted: number }> {
  if (!ids.length) return { deleted: 0 };
  return prisma.$transaction(async (tx) => {
    const entries = await tx.subscriptionEntry.findMany({
      where: { subscriberId: { in: ids } }, select: { id: true },
    });
    const entryIds = entries.map((e) => e.id);
    const invoices = await tx.invoice.findMany({
      where: { subscriberId: { in: ids } }, select: { id: true },
    });
    const invoiceIds = invoices.map((i) => i.id);

    // حركات الصندوق المرتبطة بالمشترك: دين (sourceId=مشترك)، تفعيل (sourceId=وصل)، فاتورة (sourceId=فاتورة)
    await tx.moneyTx.deleteMany({
      where: {
        OR: [
          { sourceType: "debt", sourceId: { in: ids } },
          ...(entryIds.length ? [{ sourceType: "activation", sourceId: { in: entryIds } }] : []),
          ...(invoiceIds.length ? [{ sourceType: "invoice", sourceId: { in: invoiceIds } }] : []),
        ],
      },
    });
    if (invoiceIds.length) await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.invoice.deleteMany({ where: { subscriberId: { in: ids } } });
    await tx.subscriptionEntry.deleteMany({ where: { subscriberId: { in: ids } } });
    await tx.message.deleteMany({ where: { subscriberId: { in: ids } } });
    const res = await tx.subscriber.deleteMany({ where: { id: { in: ids } } });
    return { deleted: res.count };
  });
}
