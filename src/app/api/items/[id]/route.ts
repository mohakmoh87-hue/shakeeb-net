import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { batchTag } from "@/app/api/_lib/itemBatchLog";

const schema = z.object({
  name: z.string().min(1, "اسم المادة مطلوب"),
  category: z.string().nullable().optional(),
  priceSale: z.coerce.number().nullable().optional(),
  priceSale2: z.coerce.number().nullable().optional(),
  priceDinar: z.coerce.number().nullable().optional(),
  count: z.coerce.number().nullable().optional(),
  barcode: z.string().nullable().optional(),
  // 📦 سعرُ شراء **هذه الدفعة** — يُسجَّل في الأثر ولا يُكتب فوق كلفة المادة
  batchBuyPrice: z.coerce.number().nullable().optional(),
});

// تعديل مادة. المدير: كل الحقول. المستخدم العادي: **الكمية فقط وبالزيادة لا الإنقاص**
// (يستلم بضاعة فيضيفها؛ أمّا الإنقاص فيتمّ بالبيع/الذمم لا بتحرير الرقم يدوياً).
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  // منع تعديل مادة مكتب آخر
  const existing = await prisma.item.findUnique({ where: { id: Number(id) }, select: { towerId: true, count: true, name: true, priceDinar: true } });
  if (!existing || !(await ownsTower(g.session, existing.towerId))) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }

  // ===== قيد تدقيق لكل تغيير كمية (قرار محمد 2026-08-05) =====
  // كانت الكمية تُكتب فوق الكمية بلا أثر: من صفر إلى خمسين بلا اسمٍ ولا وقت ولا رقم سابق.
  // فلو اختلف المخزن عن الواقع لما أمكن معرفة متى بدأ الخلل ولا بيد مَن. الآن كل تغيير يُسجَّل.
  const logQty = async (before: number, after: number, buyPrice?: number | null) => {
    if (before === after) return;
    const up = after > before;
    await prisma.auditLog.create({
      data: {
        userId: g.session?.userId ?? null,
        action: up ? "ITEM_QTY_UP" : "ITEM_QTY_DOWN",
        entity: "item",
        entityId: String(id),
        details:
          (up ? "زيادة كمية «" : "إنقاص كمية «") + (existing.name ?? id) + "» من " + before + " إلى " + after +
          " (" + (up ? "+" : "−") + Math.abs(after - before) + ")" +
          (up && buyPrice ? " — سعر شراء الدفعة " + Math.round(buyPrice) : "") +
          " — مكتب " + (existing.towerId ?? "—") +
          (g.session?.fullName || g.session?.username ? " — بواسطة " + (g.session.fullName ?? g.session.username) : "") +
          // 📦 وسمٌ آليُّ القراءة في الذيل — منه تُبنى صفحةُ «سجل الدفعات» بلا تخمين
          batchTag(before, after, up ? buyPrice : null),
      },
    }).catch(() => { /* لا نُفشل التعديل بسبب القيد */ });
  };

  // ═════ 📦 «يجب إدخالُ سعر المادة عند زيادة عددها» (قرارُ محمد 2026-08-25) ═════
  // 🔒 والحكمُ **خادميٌّ لا واجهةٌ فقط**: بلا سعرٍ لا يُعرَف بكم اشتُريت الدفعةُ أبداً،
  //    وهو عينُ ما شكا منه. ويُشترَط عند **الزيادة وحدَها** — فالإنقاصُ ليس شراءً،
  //    وتعديلُ اسمٍ أو سعرِ بيعٍ بلا مساسٍ بالكميّة لا يُطالَب بسعر دفعة.
  const requireBatchPrice = (before: number, after: number, price: number | null | undefined) => {
    if (after <= before) return null;
    if (price != null && Number.isFinite(price) && price > 0) return null;
    return NextResponse.json({ error: "أدخل سعر شراء هذه الدفعة — لا تُقبل زيادةُ الكمية بلا سعر" }, { status: 400 });
  };

  // ===== المستخدم العادي: زيادة الكمية حصراً =====
  if (!g.session?.isAdmin) {
    const q = z.object({ count: z.coerce.number(), batchBuyPrice: z.coerce.number().nullable().optional() }).safeParse(body);
    if (!q.success) return NextResponse.json({ error: "أدخل الكمية الجديدة" }, { status: 400 });
    const current = existing.count ?? 0;
    if (q.data.count < current) {
      return NextResponse.json(
        { error: `لا يمكنك إنقاص الكمية (الحالية ${current}) — الزيادة فقط. لتعديل غير ذلك راجع المدير` },
        { status: 403 },
      );
    }
    const bad = requireBatchPrice(current, q.data.count, q.data.batchBuyPrice);
    if (bad) return bad;
    // 🔑 الكميّةُ وحدَها تُكتب — **`priceDinar` لا يُمَسّ** (قرارُ محمد: سجلٌّ للقراءة،
    //    فلا يتغيّر حسابُ الربح ولا كلفةُ المادة بزيادةِ دفعةٍ بسعرٍ مختلف).
    const bumped = await prisma.item.update({ where: { id: Number(id) }, data: { count: q.data.count } });
    await logQty(current, q.data.count, q.data.batchBuyPrice);
    return NextResponse.json(bumped);
  }

  // ===== المدير: تعديل كامل =====
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  // 📦 سعرُ الدفعة للمدير: حقلُه الصريح إن ملأه، وإلّا الكلفةُ التي كتبها في النموذج
  //    نفسِه (`priceDinar`) — فلا يُطالَب بكتابة الرقم مرّتَين في شاشةٍ واحدة.
  const { batchBuyPrice, ...itemData } = parsed.data;
  const adminBatchPrice = batchBuyPrice ?? parsed.data.priceDinar ?? existing.priceDinar;
  if (parsed.data.count != null) {
    const bad = requireBatchPrice(existing.count ?? 0, parsed.data.count, adminBatchPrice);
    if (bad) return bad;
  }
  const updated = await prisma.item.update({
    where: { id: Number(id) },
    data: itemData,
  });
  // حتى تعديل المدير يُسجَّل — فالسجل لا يُفيد إن كان يوثّق نصف الأيدي
  if (parsed.data.count != null) await logQty(existing.count ?? 0, parsed.data.count, adminBatchPrice);
  return NextResponse.json(updated);
}

// حذف مادة — للمدير فقط (اتّساقاً مع قصر الإضافة عليه؛ المستخدم يزيد الكميات لا غير)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  if (!g.session?.isAdmin) {
    return NextResponse.json({ error: "حذف المواد من صلاحية المدير فقط" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.item.findUnique({ where: { id: Number(id) }, select: { towerId: true } });
  if (!existing || !(await ownsTower(g.session, existing.towerId))) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }
  await prisma.item.update({
    where: { id: Number(id) },
    data: { isDeleted: true },
  });
  return NextResponse.json({ ok: true });
}
