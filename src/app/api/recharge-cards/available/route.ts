import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// قائمة كروت التفعيل المتاحة (غير المستخدمة) في المخزن — متاحة لكل مستخدم مسجّل الدخول.
// الكروت مخزون مشترك بين كل المكاتب: أي مستخدم يضيفها وأي مستخدم يراها ويستخدمها.
// يُرجع أيضاً canDelete للتحكم بإظهار أدوات الحذف (صلاحية cards.delete).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const cards = await prisma.rechargeCard.findMany({
    where: { useDate: null, agentId: session.agentId ?? -1 }, // عزل: كروت وكيل المستخدم فقط
    orderBy: { id: "desc" },
    take: 2000,
    select: { id: true, serial: true, packageId: true, price: true, addDate: true },
  });
  const packages = await prisma.package.findMany({
    where: { isDeleted: false, agentId: session.agentId ?? -1 }, // عزل: باقات وكيل المستخدم
    select: { id: true, name: true },
  });
  const nameById = new Map(packages.map((p) => [p.id, p.name]));

  const canDelete =
    session.isAdmin || (session.permissions ?? []).includes("cards.delete");

  return NextResponse.json({
    cards: cards.map((c) => ({
      id: c.id,
      serial: c.serial,
      packageId: c.packageId,
      packageName: c.packageId ? nameById.get(c.packageId) ?? null : null,
      price: c.price,
      addDate: c.addDate,
    })),
    canDelete,
  });
}
