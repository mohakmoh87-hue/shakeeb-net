import type { Prisma } from "@prisma/client";

// ═════ و-٢ · إرجاعُ بضاعةِ الفاتورة — **دالّةٌ واحدةٌ لكلّ مسارٍ يحذف فاتورة** ═════
//
// 🔴 **علّةٌ مقيسةٌ على الإنتاج (2026-08-14)، وهي مثالُ محمد بالحرف**:
//   «تمّ حذفُ قطعةٍ من مادةٍ في المبيعات — يلتقط الحدثَ ويُبلِّغ به ويعطي إجراءات».
//
//   كان في البرنامج **مسارانِ يحذفان الفاتورة**:
//     • `invoices/[id]/void` — سليمٌ تماماً: يُرجع الكميّاتَ للمخزن، ويُرجعها لذمّة
//       الفنيّ في فواتير الصيانة، ويُبطل قيدَ الصندوق، ويُعلّم البنودَ محذوفة.
//     • `money/[id]/void` — كان يكتب **سطراً واحداً**: `invoice.isDeleted = true`.
//       فتُمحى الورقةُ ويبقى **المخزنُ ناقصاً** وبنودُ الفاتورة حيّةً بلا فاتورة.
//
//   ⚖️ **والأثرُ قِيس**: بندانِ حيّانِ في فاتورةٍ محذوفة، وقطعتانِ لم ترجعا للمخزن —
//   أي مادّةٌ خرجت من المخزن وأُلغي بيعُها فلا هي مبيعةٌ ولا هي في الرفّ.
//
// 🔑 والدرسُ الذي يمنع تكرارَها: **الأثرُ العكسيُّ يسكن دالّةً واحدةً لا يُنسَخ في مسارَين**.
//   فنسخُه يعني أنّ إصلاحَ أحدِهما لا يُصلح الآخر، وهذا ما وقع بالضبط.

/**
 * يُرجع بضاعةَ الفاتورة إلى المخزن (وإلى ذمّة الفنيّ في فواتير الصيانة)، ويُعلّم
 * بنودَها محذوفة. تُنادى **داخل معاملةٍ** كي لا يرجع المخزنُ بلا حذفِ الفاتورة أو بالعكس.
 *
 * @returns عددُ البنود المُرجَعة ومجموعُ الكميّات — لتُسجَّل في التدقيق فيُقرأ الأثرُ لاحقاً.
 */
export async function reverseInvoiceStock(
  tx: Prisma.TransactionClient,
  invoiceId: number,
  /** فنيُّ بطاقةِ الصيانة إن كانت الفاتورةُ فاتورةَ صيانةٍ — تُرجَع الكميّةُ لذمّته أيضاً */
  maintTech: number | null = null,
): Promise<{ lines: number; qty: number }> {
  const lines = await tx.invoiceItem.findMany({ where: { invoiceId, isDeleted: false } });
  let qty = 0;
  for (const l of lines) {
    if (l.itemId) {
      await tx.item.update({ where: { id: l.itemId }, data: { count: { increment: l.count ?? 0 } } });
      qty += l.count ?? 0;
      if (maintTech != null && (l.count ?? 0) > 0) {
        const custody = await tx.custody.findFirst({
          where: { technicianId: maintTech, itemId: l.itemId, isDeleted: false },
        });
        if (custody) {
          await tx.custody.update({ where: { id: custody.id }, data: { qty: custody.qty + (l.count ?? 0) } });
        } else {
          const item = await tx.item.findUnique({ where: { id: l.itemId }, select: { towerId: true } });
          await tx.custody.create({
            data: { technicianId: maintTech, itemId: l.itemId, qty: l.count ?? 0, towerId: item?.towerId ?? null },
          });
        }
      }
    }
    await tx.invoiceItem.update({ where: { id: l.id }, data: { isDeleted: true } });
  }
  return { lines: lines.length, qty };
}
