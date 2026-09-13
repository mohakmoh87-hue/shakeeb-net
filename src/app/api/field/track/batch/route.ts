import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";
import { isTrackPulseFresh } from "@/lib/tracking";
import { baghdadDayKey } from "@/lib/attendance";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  points: z
    .array(
      z.object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        at: z.coerce.date(),
        acc: z.coerce.number().min(0).max(100000).optional(),
      }),
    )
    .min(1)
    .max(500),
});

// POST (فني): دفعة نقاط GPS مجموعة على الهاتف. تُخزَّن ما دام التتبع فعّالاً (وردية أو نبضة مدير)،
// وآخر نقطة تُحدّث الموقع الحيّ. غير فعّال ⇒ tracking:false فيوقف الهاتف الإرسال.
export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "نقاط غير صحيحة" }, { status: 400 });

  const t = await prisma.technician.findUnique({
    where: { id: tech.technicianId },
    select: { towerId: true, trackShiftActive: true, trackReqAt: true },
  });
  const active = !!t && (t.trackShiftActive || isTrackPulseFresh(t.trackReqAt));
  if (!active) return NextResponse.json({ tracking: false });

  const pts = parsed.data.points;
  await prisma.trackPoint.createMany({
    data: pts.map((p) => ({
      technicianId: tech.technicianId,
      agentId: tech.agentId,
      towerId: t?.towerId ?? null,
      lat: p.lat,
      lng: p.lng,
      acc: p.acc ?? null,
      at: p.at,
      dayKey: baghdadDayKey(p.at),
    })),
  });

  const last = pts.reduce((a, b) => (b.at.getTime() >= a.at.getTime() ? b : a), pts[0]);
  await prisma.technician
    .update({ where: { id: tech.technicianId }, data: { trackLat: last.lat, trackLng: last.lng, trackAt: last.at } })
    .catch(() => {});

  return NextResponse.json({ tracking: true, saved: pts.length });
}
