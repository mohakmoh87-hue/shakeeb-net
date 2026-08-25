import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { batchTag, movingAverage } from "@/app/api/_lib/itemBatchLog";

const schema = z.object({
  // 🔑 الاسمُ **اختياريٌّ في التعديل** منذ 2026-08-25: صار نموذجُ «تعديل» للمدير كميّةً
  //    وحدَها (قرارُ محمد)، فاشتراطُه كان سيردّ كلَّ تصحيحِ عددٍ بـ«اسم المادة مطلوب».
  //    ومَن أرسله يُكتب كما كان — فلا يُفقَد سلوكٌ قائم.
  name: z.string().min(1, "اسم المادة مطلوب").optional(),
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
    // 📊 الكلفةُ تصير **المتوسّطَ المرجّح** لا سعرَ الدفعة الأخيرة (بلاغ محمد 2026-08-25)
    const avg = movingAverage(current, existing.priceDinar, q.data.count - current, q.data.batchBuyPrice ?? 0);
    const bumped = await prisma.item.update({
      where: { id: Number(id) },
      data: { count: q.data.count, priceDinar: Math.round(avg) },
    });
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
  // 📦 سعرُ الدفعة للمدير: **حقلُه الصريحُ وحدَه** لا خانةُ الكلفة.
  // 🔴 وكان يُشتقّ من `priceDinar` — وهو عينُ ما شكا منه محمد: يكتب سعرَ الدفعة في خانة
  //    الكلفة فيُكتب فوق **المخزون كلِّه** («يتغيّر معه سعرُ الشراء لكلّ العدد السابق»).
  const { batchBuyPrice, ...itemData } = parsed.data;
  const before = existing.count ?? 0;
  const hasBatchPrice = batchBuyPrice != null && Number.isFinite(batchBuyPrice) && batchBuyPrice > 0;
  const isIncrease = parsed.data.count != null && parsed.data.count > before;
  // ═════ ✏️ «زرُّ تعديل يعود إلى ما كان عليه: يزيد أو ينقص عددَ مادة» (محمد 2026-08-25) ═════
  // فالشراءُ صار له بابُه: نافذةُ «➕ إضافة مادة» التي تُرسل `batchBuyPrice` فيُحسب المتوسّط.
  // وزرُّ «تعديل» للمدير صار **تصحيحَ عددٍ لا شراءً** ⇒ لا يُطالَب بسعر.
  // 🔑 وتصحيحٌ بلا سعرٍ **لا يُحرّك المتوسّط**: القطعُ المضافةُ تُقوَّم بمتوسّط ما في يده
  //    (وهو معنى التصحيح)، فلا يُخترَع لها سعرٌ ولا يُفسَد به تاريخُ الشراء.
  // ⚠️ والمستخدمُ العاديُّ يبقى مُطالَباً بالسعر أعلاه — فبابُه إلى المخزن هو «تعديل» وحدَه
  //    (نافذةُ الإضافة للمدير حصراً بقرار محمد)، فلولا الشرطُ لدخلت بضاعتُه بلا سعرٍ أبداً.
  if (isIncrease && hasBatchPrice) {
    itemData.priceDinar = Math.round(
      movingAverage(before, existing.priceDinar, (parsed.data.count ?? 0) - before, batchBuyPrice ?? 0),
    );
  }
  const updated = await prisma.item.update({
    where: { id: Number(id) },
    data: itemData,
  });
  // حتى تعديل المدير يُسجَّل — فالسجل لا يُفيد إن كان يوثّق نصف الأيدي
  // 🔑 والسجلُّ يحفظ **سعرَ الدفعة نفسِه** لا المتوسّط — فالمتوسّطُ يُشتقّ منه، وحفظُه
  //    مكانَه كان سيُضيع السعرَ الحقيقيَّ الذي اشتُريت به هذه الدفعة.
  if (parsed.data.count != null) await logQty(before, parsed.data.count, batchBuyPrice);
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
