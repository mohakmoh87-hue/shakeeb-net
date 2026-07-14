import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isFieldManager } from "@/lib/field";

export const dynamic = "force-dynamic";

// تحصيل الفنيين: لكل فني مجموع مبالغ تكتاته المنجزة غير المحصّلة (معلّقة).
// مستخدم المكتب يرى فنيّي مكتبه؛ المدير يرى كل المكاتب.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const manager = isFieldManager(session);

  const techWhere = manager
    ? { isDeleted: false }
    : { isDeleted: false, OR: [{ towerId: session.towerId ?? null }, { supportTowerId: session.towerId ?? null }] };
  const technicians = await prisma.technician.findMany({
    where: techWhere,
    select: { id: true, name: true, towerId: true },
    orderBy: { id: "asc" },
  });
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false }, select: { id: true, name: true }, orderBy: { id: "asc" },
  });

  // البطاقات المنجزة غير المحصّلة، مجمّعة حسب الفني
  const pending = await prisma.taskCard.groupBy({
    by: ["technicianId"],
    where: { done: true, settled: false, isDeleted: false, technicianId: { in: technicians.map((t) => t.id) } },
    _sum: { amount: true },
    _count: true,
  });
  const map = new Map(pending.map((p) => [p.technicianId, { total: p._sum.amount ?? 0, count: p._count }]));

  return NextResponse.json({
    isManager: manager,
    offices,
    technicians: technicians.map((t) => ({
      id: t.id, name: t.name, towerId: t.towerId,
      pendingTotal: map.get(t.id)?.total ?? 0,
      pendingCount: map.get(t.id)?.count ?? 0,
    })),
  });
}

// اكمال: تحصيل تكتات فني (تُعلَّم محصّلة وتُزال من اللوحة، وتُحذف صورها فعلياً).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  const technicianId = Number(b?.technicianId);
  if (!technicianId) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });

  // عزل: مستخدم المكتب يحصّل فنيّي مكتبه فقط
  const tech = await prisma.technician.findUnique({ where: { id: technicianId } });
  if (!tech) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  if (!isFieldManager(session) && tech.towerId !== (session.towerId ?? null)) {
    return NextResponse.json({ error: "لا يمكنك تحصيل فني مكتب آخر" }, { status: 403 });
  }

  const cards = await prisma.taskCard.findMany({
    where: { technicianId, done: true, settled: false, isDeleted: false },
    select: { id: true, amount: true },
  });
  const ids = cards.map((c) => c.id);
  const total = cards.reduce((s, c) => s + (c.amount ?? 0), 0);

  if (ids.length > 0) {
    await prisma.$transaction([
      prisma.taskCard.updateMany({ where: { id: { in: ids } }, data: { settled: true, isDeleted: true } }),
      prisma.cardPhoto.deleteMany({ where: { cardId: { in: ids } } }),
    ]);
  }
  return NextResponse.json({ ok: true, settledCount: ids.length, total });
}
