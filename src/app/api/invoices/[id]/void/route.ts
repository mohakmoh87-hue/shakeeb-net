import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// حذف فاتورة مبيع عكسياً: إلغاء المبلغ من الصندوق + إرجاع المواد للمخزون + حذف الفاتورة
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("receipts.void");
  if (g.error) return g.error;
  const session = await getSession();
  const reverse = (await request.json().catch(() => ({})))?.reverse !== false; // افتراضي true

  const { id } = await params;
  const invoiceId = Number(id);

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.isDeleted || !(await ownsTower(g.session, invoice.towerId))) {
    return NextResponse.json({ error: "الفاتورة غير موجودة أو محذوفة مسبقاً" }, { status: 404 });
  }

  // فاتورة «بيع صيانة» (من إنجاز بطاقة): بيعُها كان من ذمّة الفني — الحذف العكسي يعيد
  // المواد لذمّته وللمخزن معاً (عكس البيع تماماً). نستخرج رقم التكت من ملاحظة الفاتورة.
  const maintCardId = invoice.type === "بيع صيانة"
    ? Number(invoice.note?.match(/تكت\s*#(\d+)/)?.[1]) || null
    : null;
  const maintTech = maintCardId
    ? (await prisma.taskCard.findUnique({ where: { id: maintCardId }, select: { technicianId: true } }))?.technicianId ?? null
    : null;

  // ب-٠٠ · أثرُ الإرجاع على دَين المشترك — يُسجَّل صريحاً في التدقيق (انظر البند ٣ أدناه)
  let debtBefore = 0, debtApplied = 0, clampedDebt = 0;

  try {
    await prisma.$transaction(async (tx) => {
     if (reverse) {
      // 1) إرجاع المواد للمخزون (+ لذمّة الفني في فواتير الصيانة)
      const lines = await tx.invoiceItem.findMany({ where: { invoiceId, isDeleted: false } });
      for (const l of lines) {
        if (l.itemId) {
          await tx.item.update({ where: { id: l.itemId }, data: { count: { increment: l.count ?? 0 } } });
          // إعادة الكمية لذمّة الفني الذي بِيعت من ذمّته (فواتير الصيانة فقط)
          if (maintTech != null && (l.count ?? 0) > 0) {
            const custody = await tx.custody.findFirst({ where: { technicianId: maintTech, itemId: l.itemId, isDeleted: false } });
            if (custody) {
              await tx.custody.update({ where: { id: custody.id }, data: { qty: custody.qty + (l.count ?? 0) } });
            } else {
              const item = await tx.item.findUnique({ where: { id: l.itemId }, select: { towerId: true } });
              await tx.custody.create({ data: { technicianId: maintTech, itemId: l.itemId, qty: l.count ?? 0, towerId: item?.towerId ?? null } });
            }
          }
        }
        await tx.invoiceItem.update({ where: { id: l.id }, data: { isDeleted: true } });
      }

      // 2) إلغاء المبلغ من الصندوق
      // يشمل "master": فاتورة الماستر (والمختلطة) صفّاها يُعكسان معاً
      await tx.moneyTx.updateMany({
        where: { sourceType: { in: ["invoice", "master-invoice"] }, sourceId: invoiceId, isDeleted: false },
        data: { isDeleted: true },
      });

      // 3) إرجاع دين الفاتورة (المتبقّي) على المشترك
      // ===== ب-٠٠ · الحرجة ٤: القصُّ يصير **ظاهراً** لا صامتاً =====
      // `max(0, carry − remainder)` هو أحوطُ ما يمكن حسابُه — لكنّه يخفي حالتَين مختلفتَين تماماً:
      //  (أ) دَينُ المشترك أكبرُ من متبقّي الفاتورة ⇒ يُطرح المتبقّي كلُّه وهذا صحيحٌ تماماً.
      //  (ب) دَينُه **أصغر** ⇒ يُقصّ الطرحُ عند صفر. وهنا الغموض: إمّا أنّه سدّد جزءاً من هذه
      //      الفاتورة (فالقصُّ صحيح)، أو أنّ دَينَه من فاتورةٍ **أخرى** فالقصُّ **يمحو دَينَها**.
      // والبرنامجُ لا يتتبّع دَينَ كلّ فاتورةٍ منفصلاً فلا سبيلَ إلى التمييز حساباً — **ولا يجوز
      // أن يمرّ فرقٌ في دَين مشتركٍ بلا أثرٍ مقروء**. فيُسجَّل المطروحُ فعلاً والمقصوصُ صريحاً،
      // فتراه في سجلّ التدقيق وتُراجعه بنفسك. (والحلُّ الجذريّ تتبُّعُ الدَّين لكلّ فاتورة — بندٌ مستقلّ.)
      const remainder = Math.max(0, (invoice.totalMy ?? 0) - (invoice.waselHim ?? 0));
      if (remainder > 0 && invoice.subscriberId) {
        const sub = await tx.subscriber.findUnique({ where: { id: invoice.subscriberId } });
        if (sub) {
          const before = sub.carry ?? 0;
          const applied = Math.min(remainder, Math.max(0, before)); // المطروحُ فعلاً
          clampedDebt = remainder - applied; // ما لم يُطرح لأنّ دَينَه لم يكفِ
          debtBefore = before;
          debtApplied = applied;
          await tx.subscriber.update({
            where: { id: sub.id },
            data: { carry: before - applied },
          });
        }
      }
     } // نهاية كتلة الإرجاع العكسي (reverse)

      // حذف الفاتورة نفسها — يتم دائماً (مع الإرجاع أو بدونه)
      await tx.invoice.update({ where: { id: invoiceId }, data: { isDeleted: true } });

      await tx.auditLog.create({
        data: {
          userId: session?.userId, action: "VOID_RECEIPT", entity: "invoice", entityId: String(invoiceId),
          details: `حذف فاتورة مبيع ${reverse ? "عكسياً (إرجاع)" : "بلا تأثير مالي"} #${invoice.number} - إجمالي ${invoice.totalMy} - واصل ${invoice.waselHim}`
            // ب-٠٠ · أثرُ الدَّين مكتوبٌ بالأرقام: كان كذا ← طُرح كذا. والمقصوصُ يُذكَر بتحذيرٍ
            // صريحٍ لأنّه الحالةُ التي قد يكون فيها الدَّينُ من فاتورةٍ أخرى — فتُراجعها بنفسك.
            + (reverse && debtApplied > 0 ? ` - دَين المشترك ${debtBefore} ← طُرح ${debtApplied}` : "")
            + (reverse && clampedDebt > 0
              ? ` - ⚠️ لم يُطرح ${clampedDebt} لأنّ دَينه لم يكفِ (إمّا سدّده سابقاً أو دَينُه من فاتورةٍ أخرى — راجِعه)`
              : ""),
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف الفاتورة" }, { status: 500 });
  }
}
