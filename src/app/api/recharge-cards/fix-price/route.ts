import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// تصحيح سعر مجموعة كروت متاحة أُدخِلت بسعر خاطئ قبل الإضافة (للمدير حصراً — يغيّر ديون الكارتات).
// يشمل الكروت المتاحة (غير المستخدمة) لهذه الفئة بالسعر القديم فقط — لا يمسّ المستخدمة ولا الكروت
// التي أُضيفت بأسعار أخرى (فتبقى ثابتة على أسعارها).
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (!s.isAdmin) return NextResponse.json({ error: "تصحيح سعر الكارت للمدير حصراً" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = z.object({
    packageId: z.coerce.number(),
    oldPrice: z.coerce.number().min(0),
    newPrice: z.coerce.number().min(0),
  }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const { packageId, oldPrice, newPrice } = parsed.data;

  // عزل المستأجر: الباقة تتبع وكيل المستخدم
  const pkg = await prisma.package.findFirst({ where: { id: packageId, agentId: s.agentId ?? -1 } });
  if (!pkg) return NextResponse.json({ error: "الباقة غير موجودة" }, { status: 404 });

  // تحديث الكروت المتاحة لهذه الفئة بالسعر القديم فقط (معزول بالوكيل)
  const res = await prisma.rechargeCard.updateMany({
    where: { agentId: s.agentId ?? -1, packageId, useDate: null, price: oldPrice },
    data: { price: newPrice },
  });
  return NextResponse.json({ ok: true, updated: res.count });
}
