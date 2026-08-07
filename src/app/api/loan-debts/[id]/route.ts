import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// إلغاء قرضٍ عكسيّاً (طلب محمد 2026-08-07): يحذف دَين القرض، ويُرجع تاريخ انتهاء المشترك
// لما كان **قبل** القرض (تزول الـ٣٠ يوماً الوهميّة) — كأنّ القرض لم يُمنح. الساس لا يُمَسّ
// (تبقى أيّامه السبعة الحقيقيّة، لا يمكن تغييرها). عزل: مقيَّد بمكتب القرض ووكيله.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const loanId = Number(id);

  const loan = await prisma.loanDebt.findUnique({ where: { id: loanId } });
  // عزل الوكيل: لا يُلغى إلا قرضٌ يتبع مكاتب وكيل المستخدم
  if (!loan || loan.isDeleted || !(await sameAgentTower(g.session, loan.towerId))) {
    return NextResponse.json({ error: "القرض غير موجود" }, { status: 404 });
  }

  // التاريخ الذي نُرجع إليه: ما كان قبل القرض؛ وإن غاب (قروض قديمة) نرجع لتاريخ المنح
  // (المشترك كان منتهياً حينها) — فتزول الأيّام الوهميّة على كلّ حال.
  const restoreDateTo = loan.prevDateTo ?? loan.grantDate;

  await prisma.$transaction([
    prisma.subscriber.update({ where: { id: loan.subscriberId }, data: { dateTo: restoreDateTo } }),
    prisma.loanDebt.delete({ where: { id: loanId } }),
    prisma.auditLog.create({
      data: {
        userId: session?.userId,
        action: "REVERSE_LOAN",
        entity: "subscriber",
        entityId: String(loan.subscriberId),
        details: `إلغاء قرض عكسيّاً — ${loan.netUser ?? loan.subscriberId} — مبلغ ${loan.amount} — أُرجع التاريخ إلى ${restoreDateTo ? new Date(restoreDateTo).toISOString().slice(0, 10) : "بلا"}`,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
