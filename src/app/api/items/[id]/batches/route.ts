import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { readItemBatches } from "@/app/api/_lib/itemBatchLog";

export const dynamic = "force-dynamic";

// 📦 سجلُّ دفعات مادةٍ واحدة — «كيف سأعرف سعرَ شراء المادة في كلّ مرّةٍ أزيد العدد؟»
// (سؤالُ محمد 2026-08-25). قراءةٌ محضة: لا يكتب شيئاً ولا يمسّ كلفةً ولا ربحاً.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  // 🔒 **الكلفةُ للمدير حصراً** — تماماً كخانة «الكلفة» في المخزن التي يحجبها مسارُ
  //    `items` عن غير المدير (`priceDinar: null`). فبلا هذا الشرط كان هذا المسارُ الجديد
  //    باباً خلفيّاً يكشف أسعارَ الشراء كلَّها لأيّ موظّفٍ يملك `inventory.manage`.
  //    والموظّفُ يكتب سعرَ دفعته عند استلامها ولا يرى تاريخَ الأسعار.
  if (!g.session?.isAdmin) {
    return NextResponse.json({ error: "سجلّ الدفعات من صلاحية المدير فقط" }, { status: 403 });
  }

  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) return NextResponse.json({ error: "معرّف غير صالح" }, { status: 400 });

  // 🔒 **العزلُ قبل القراءة**: سجلُّ الدفعات يكشف كلفةَ الشراء — وهي من أخصّ أسرار الوكيل.
  //    فلا يُقرأ صفٌّ إلّا بعد التثبّت أنّ المادةَ من مكاتب وكيل هذه الجلسة، تماماً كما
  //    يفعل مسارُ التعديل. ومادّةٌ غيرُ موجودةٍ ومادّةُ وكيلٍ آخرَ تُعطيان الردَّ نفسَه.
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { towerId: true, name: true, count: true, priceDinar: true } });
  if (!item || !(await ownsTower(g.session, item.towerId))) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }

  const rows = await readItemBatches(itemId);
  return NextResponse.json({
    item: { name: item.name, count: item.count ?? 0, priceDinar: item.priceDinar ?? null },
    rows,
  });
}
