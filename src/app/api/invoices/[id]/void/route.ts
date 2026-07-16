import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// حذف فاتورة مبيع عكسياً: إلغاء المبلغ من الصندوق + إرجاع المواد للمخزون + حذف الفاتورة
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("receipts.void");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const invoiceId = Number(id);

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.isDeleted || !(await ownsTower(g.session, invoice.towerId))) {
    return NextResponse.json({ error: "الفاتورة غير موجودة أو محذوفة مسبقاً" }, { status: 404 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1) إرجاع المواد للمخزون
      const lines = await tx.invoiceItem.findMany({ where: { invoiceId, isDeleted: false } });
      for (const l of lines) {
        if (l.itemId) {
          await tx.item.update({ where: { id: l.itemId }, data: { count: { increment: l.count ?? 0 } } });
        }
        await tx.invoiceItem.update({ where: { id: l.id }, data: { isDeleted: true } });
      }

      // 2) إلغاء المبلغ من الصندوق
      await tx.moneyTx.updateMany({
        where: { sourceType: "invoice", sourceId: invoiceId, isDeleted: false },
        data: { isDeleted: true },
      });

      // 3) إرجاع دين الفاتورة (المتبقّي) على المشترك
      const remainder = Math.max(0, (invoice.totalMy ?? 0) - (invoice.waselHim ?? 0));
      if (remainder > 0 && invoice.subscriberId) {
        const sub = await tx.subscriber.findUnique({ where: { id: invoice.subscriberId } });
        if (sub) {
          await tx.subscriber.update({
            where: { id: sub.id },
            data: { carry: Math.max(0, (sub.carry ?? 0) - remainder) },
          });
        }
      }

      // 4) حذف الفاتورة
      await tx.invoice.update({ where: { id: invoiceId }, data: { isDeleted: true } });

      await tx.auditLog.create({
        data: {
          userId: session?.userId, action: "VOID_RECEIPT", entity: "invoice", entityId: String(invoiceId),
          details: `حذف فاتورة مبيع عكسياً #${invoice.number} - إجمالي ${invoice.totalMy} - واصل ${invoice.waselHim}`,
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف الفاتورة" }, { status: 500 });
  }
}
