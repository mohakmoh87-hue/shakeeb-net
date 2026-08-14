import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { convertMoneyKind } from "@/app/api/_lib/convertKind";

// ═════ أ-٥/٣ · التحويلُ **من سجلّ وصولات المشترك** (طلبُ محمد 2026-08-14) ═════
//
// «عند الدخول إلى سجلّ مشترك يجب أن أستطيع تحويلَ الوصل إلى ماستر أو نقد» — وهو الموضعُ
// الطبيعيُّ للفعل: الوصلُ أمامك في سجلّ صاحبه. (وكان الزرُّ في صفحة المصروفات وحدها.)
//
// 🔑 والفرقُ التقنيُّ الذي يستدعي مساراً ثانياً: هنا المعرّفُ **معرّفُ قيدِ التفعيل**
//   (`subscription_entries.id`) لا معرّفُ حركة الصندوق. فتُستخرج حركتُه أوّلاً — ولو مُرِّر
//   معرّفُ القيد إلى مسار المال لَحُوِّلت **حركةٌ أخرى بالمصادفة** (نفسُ درسِ زرّ الحذف
//   في تفصيل التقرير: لا يُقبَل إلّا معرّفُ حركةِ صندوقٍ صريح).
//
// ⚠️ وتفعيلٌ **بلا واصل** (كلُّه على الدَّين) لا حركةَ صندوقٍ له ⇒ لا شيءَ يُحوَّل، ويُقال
//   ذلك صراحةً بدل صمتٍ يُوهم أنّ الزرَّ لا يعمل.

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("receipts.void"); // مَن يملك إبطالَ وصلٍ يملك تحويلَ نوعه
  if (g.error) return g.error;

  const { id } = await params;
  const entryId = Number(id);
  const entry = await prisma.subscriptionEntry.findUnique({
    where: { id: entryId },
    select: { id: true, towerId: true, isDeleted: true },
  });
  if (!entry || entry.isDeleted) return NextResponse.json({ error: "الوصل غير موجود أو محذوف" }, { status: 404 });
  // 🔒 العزل: مكتبُ الوصل من مكاتب وكيل الجلسة
  if (!(await ownsTower(g.session, entry.towerId))) {
    return NextResponse.json({ error: "الوصل لا يتبع حسابك" }, { status: 403 });
  }

  // حركةُ صندوق هذا الوصل — نقديّةً كانت أو ماستر
  const tx = await prisma.moneyTx.findFirst({
    where: { sourceId: entryId, sourceType: { in: ["activation", "master"] }, isDeleted: false },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!tx) {
    return NextResponse.json({
      error: "هذا الوصل بلا حركةِ صندوق (تفعيلٌ على الدَّين بواصلٍ صفر) — لا شيءَ يُحوَّل",
    }, { status: 400 });
  }

  const r = await convertMoneyKind(tx.id, g.session?.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
