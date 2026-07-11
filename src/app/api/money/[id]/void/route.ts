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

  if (tx.sourceType === "activation") {
    return NextResponse.json({ error: "هذه حركة تفعيل — احذف وصل التفعيل من صفحة الاشتراكات لإرجاع الأيام والكارت" }, { status: 400 });
  }
  if (tx.sourceType === "invoice") {
    return NextResponse.json({ error: "هذه حركة فاتورة — احذف الفاتورة من صفحة الفواتير لإرجاع المخزون" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (t) => {
      // تسديد دين: أرجِع المبلغ ديناً على المشترك
      if (tx.sourceType === "debt" && tx.sourceId) {
        const sub = await t.subscriber.findUnique({ where: { id: tx.sourceId } });
        if (sub) {
          await t.subscriber.update({
            where: { id: sub.id },
            data: { carry: (sub.carry ?? 0) + (tx.moneyIn ?? 0) },
          });
        }
      }
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
