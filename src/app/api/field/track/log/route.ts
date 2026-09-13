import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { detectStops, attachNearestPoles, RETENTION_DAYS } from "@/lib/tracking";
import { baghdadDayKey } from "@/lib/attendance";

export const dynamic = "force-dynamic";

// GET (field.manage): سجلّ تتبّع فنيّ.
//   بلا dayKey ⇒ قائمة أيّام آخر شهر بعدد نقاطها؛ مع dayKey ⇒ مسار اليوم + التوقّفات (>٥د).
export async function GET(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const technicianId = Number(url.searchParams.get("technicianId")) || 0;
  if (!technicianId) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });

  const t = await prisma.technician.findUnique({
    where: { id: technicianId },
    select: { id: true, name: true, towerId: true, isDeleted: true },
  });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) {
    return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  }

  const dayKey = url.searchParams.get("dayKey");
  if (dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    const rows = await prisma.trackPoint.findMany({
      where: { technicianId, dayKey },
      orderBy: { at: "asc" },
      select: { lat: true, lng: true, at: true, acc: true },
      take: 20000,
    });
    const stops = await attachNearestPoles(detectStops(rows));
    // تخفيف نقاط المسار للعرض (الخطّ) دون المساس بحساب التوقّفات (يبقى على كلّ النقاط)
    const step = Math.max(1, Math.ceil(rows.length / 3000));
    const points = step === 1 ? rows : rows.filter((_, i) => i % step === 0);
    return NextResponse.json({ technician: { id: t.id, name: t.name }, dayKey, points, stops });
  }

  const cutoff = baghdadDayKey(new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000));
  const grouped = await prisma.trackPoint.groupBy({
    by: ["dayKey"],
    where: { technicianId, dayKey: { gte: cutoff } },
    _count: { _all: true },
    _min: { at: true },
    _max: { at: true },
    orderBy: { dayKey: "desc" },
  });
  const days = grouped.map((d) => ({ dayKey: d.dayKey, count: d._count._all, first: d._min.at, last: d._max.at }));
  return NextResponse.json({ technician: { id: t.id, name: t.name }, days });
}
