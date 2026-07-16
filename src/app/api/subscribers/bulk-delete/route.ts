import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { purgeSubscribers } from "@/lib/subscriberDelete";

const schema = z.object({
  ids: z.array(z.coerce.number()).optional(),
  all: z.boolean().optional(),
});

// حذف جماعي نهائي للمشتركين (محدّدين أو الكل) مع كل سجلاتهم المرتبطة
export async function POST(request: Request) {
  const g = await guard("subscribers.delete");
  if (g.error) return g.error;
  const session = await getSession();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }
  const { ids, all } = parsed.data;

  // مستخدم المكتب مقيّد بمكتبه؛ الأدمن يشمل كل المكاتب
  const scope = await towerScope(g.session);

  // حصر المعرّفات ضمن النطاق ثم الحذف النهائي المتسلسل (مع الوصولات والحركات)
  let targetIds: number[];
  if (all) {
    targetIds = (await prisma.subscriber.findMany({ where: { ...scope }, select: { id: true } })).map((s) => s.id);
  } else if (ids && ids.length > 0) {
    targetIds = (await prisma.subscriber.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } })).map((s) => s.id);
  } else {
    return NextResponse.json({ error: "لم تحدّد مشتركين" }, { status: 400 });
  }

  const { deleted: count } = await purgeSubscribers(targetIds);

  await prisma.auditLog.create({
    data: {
      userId: session?.userId,
      action: "BULK_DELETE_SUBSCRIBERS",
      entity: "subscriber",
      details: all ? `حذف الكل (${count})` : `حذف ${count} محدّد`,
    },
  });

  return NextResponse.json({ ok: true, count });
}
