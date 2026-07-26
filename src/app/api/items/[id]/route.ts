import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";

const schema = z.object({
  name: z.string().min(1, "اسم المادة مطلوب"),
  category: z.string().nullable().optional(),
  priceSale: z.coerce.number().nullable().optional(),
  priceSale2: z.coerce.number().nullable().optional(),
  priceDinar: z.coerce.number().nullable().optional(),
  count: z.coerce.number().nullable().optional(),
  barcode: z.string().nullable().optional(),
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
  const existing = await prisma.item.findUnique({ where: { id: Number(id) }, select: { towerId: true, count: true } });
  if (!existing || !(await ownsTower(g.session, existing.towerId))) {
    return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  }

  // ===== المستخدم العادي: زيادة الكمية حصراً =====
  if (!g.session?.isAdmin) {
    const q = z.object({ count: z.coerce.number() }).safeParse(body);
    if (!q.success) return NextResponse.json({ error: "أدخل الكمية الجديدة" }, { status: 400 });
    const current = existing.count ?? 0;
    if (q.data.count < current) {
      return NextResponse.json(
        { error: `لا يمكنك إنقاص الكمية (الحالية ${current}) — الزيادة فقط. لتعديل غير ذلك راجع المدير` },
        { status: 403 },
      );
    }
    const bumped = await prisma.item.update({ where: { id: Number(id) }, data: { count: q.data.count } });
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
  const updated = await prisma.item.update({
    where: { id: Number(id) },
    data: parsed.data,
  });
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
