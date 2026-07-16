import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// حذف وصل تفعيل عكسياً: إرجاع المشترك لحالته قبل الوصل
// (إلغاء المبلغ من الصندoق + إرجاع أيام الاشتراك + إرجاع الكارت للمخزون + تصحيح الدين)
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("receipts.void");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const entryId = Number(id);

  const entry = await prisma.subscriptionEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.isDeleted || !(await ownsTower(g.session, entry.towerId))) {
    return NextResponse.json({ error: "الوصل غير موجود أو محذوف مسبقاً" }, { status: 404 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1) إرجاع المشترك: تاريخ الانتهاء لما قبل الوصل + خصم الدين الذي أضافه هذا الوصل
      if (entry.subscriberId) {
        const sub = await tx.subscriber.findUnique({ where: { id: entry.subscriberId } });
        if (sub) {
          const debtAdded = (entry.money ?? 0) + (entry.addPrice ?? 0) - (entry.moneyIn ?? 0); // الدين الذي أضافه الوصل (اشتراك + توصيل − واصل)
          // رجوع لتاريخ ما قبل التفعيل: إن كان هناك اشتراك سابق مستقبلي (dateFrom مستقبلي) نُرجعه،
          // وإلا (أول تفعيل أو كان منتهياً) نُرجع التاريخ فارغاً
          const restoredDateTo = entry.dateFrom && entry.dateFrom > new Date() ? entry.dateFrom : null;
          await tx.subscriber.update({
            where: { id: sub.id },
            data: {
              dateTo: restoredDateTo,
              carry: (sub.carry ?? 0) - debtAdded,
            },
          });
        }
      }

      // 2) إرجاع الكارت للمخزون (إن استُخدم كارت في هذا الوصل)
      if (entry.card2 && entry.subscriberId) {
        await tx.rechargeCard.updateMany({
          where: { serial: entry.card2, subscriberId: entry.subscriberId, useDate: { not: null } },
          data: { useDate: null, subscriberId: null, userName: null },
        });
      }

      // 3) إلغاء المبلغ من الصندوق (الحركة المالية المرتبطة بهذا الوصل)
      await tx.moneyTx.updateMany({
        where: { sourceType: "activation", sourceId: entryId, isDeleted: false },
        data: { isDeleted: true },
      });

      // 4) حذف الوصل نفسه
      await tx.subscriptionEntry.update({ where: { id: entryId }, data: { isDeleted: true } });

      await tx.auditLog.create({
        data: {
          userId: session?.userId, action: "VOID_RECEIPT", entity: "subscriptionEntry", entityId: String(entryId),
          details: `حذف وصل تفعيل عكسياً - مشترك ${entry.subscriberId} - مبلغ ${entry.money} - واصل ${entry.moneyIn}`,
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف الوصل" }, { status: 500 });
  }
}
