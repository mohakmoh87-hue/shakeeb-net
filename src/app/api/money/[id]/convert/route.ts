import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { convertMoneyKind } from "@/app/api/_lib/convertKind";

// ═════════ أ-٥ · الموضع ٣: تحويلُ وصلٍ قائمٍ بين **الماستر والنقديّ** ═════════
//
// طلبُ محمد: «تحويلُ وصلِ مشتركٍ موجودٍ من ماستر إلى نقديّ وبالعكس».
//
// 🔑 **والتحويلُ تبديلُ نوعٍ لا حركةٌ جديدة**: صفُّ الصندوق نفسُه يبقى بمبلغه وتاريخه
//   ومصدره، ويُبدَّل نوعُه — **ومعه وسمُ مصدره** (`subscription_entries.isMaster` أو
//   `invoices.type`) وإلّا عُدَّ المالُ مرّتَين في التقرير اليوميّ. والمنطقُ كلُّه في
//   `_lib/convertKind.ts` — يُناديه هذا المسارُ ومسارُ سجلّ المشترك، فلا تعريفَين لفعلٍ واحد.
//
// 🔒 والعزل: الصفُّ من مكتبٍ يملكه وكيلُ الجلسة (`ownsTower`) أو لا شيء.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("receipts.void"); // مَن يملك إبطالَ وصلٍ يملك تحويلَ نوعه
  if (g.error) return g.error;

  const { id } = await params;
  const txId = Number(id);
  const tx = await prisma.moneyTx.findUnique({ where: { id: txId }, select: { towerId: true, isDeleted: true } });
  if (!tx || tx.isDeleted || !(await ownsTower(g.session, tx.towerId))) {
    return NextResponse.json({ error: "الحركة غير موجودة أو محذوفة" }, { status: 404 });
  }

  const r = await convertMoneyKind(txId, g.session?.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
