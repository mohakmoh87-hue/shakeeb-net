// تتبّع الفنيّ v2 (جانب الخادم): تحكّم الوردية (بصمة→بصمة عبر FCM)، كشف التوقّفات،
// أقرب عمود شبكة لكل توقّف، والحذف الشهريّ للنقاط. جانب الهاتف في nativeTracking.ts.
import { prisma } from "@/lib/prisma";
import { sendFcmData } from "@/lib/fcm";

export const TRACK_FRESH_MS = 90_000;
export const STOP_RADIUS_M = 60;
export const STOP_MIN_MS = 5 * 60 * 1000;
export const RETENTION_DAYS = 35;

export const isTrackPulseFresh = (d: Date | null | undefined) =>
  !!d && Date.now() - d.getTime() < TRACK_FRESH_MS;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function wakeTech(technicianId: number, fcmToken: string | null, cmd: "track-start" | "track-stop") {
  if (!fcmToken) return;
  try {
    const r = await sendFcmData(fcmToken, { cmd });
    if (r.invalidToken) await prisma.technician.update({ where: { id: technicianId }, data: { fcmToken: null } }).catch(() => {});
  } catch { /* لا يُفشل البصمة */ }
}

export async function startShiftTracking(technicianId: number): Promise<void> {
  const t = await prisma.technician
    .update({ where: { id: technicianId }, data: { trackShiftActive: true }, select: { fcmToken: true } })
    .catch(() => null);
  await wakeTech(technicianId, t?.fcmToken ?? null, "track-start");
}

export async function stopShiftTracking(technicianId: number): Promise<void> {
  const t = await prisma.technician
    .update({ where: { id: technicianId }, data: { trackShiftActive: false }, select: { fcmToken: true } })
    .catch(() => null);
  await wakeTech(technicianId, t?.fcmToken ?? null, "track-stop");
}

export type TrackPt = { lat: number; lng: number; at: Date };
export type TrackStop = { lat: number; lng: number; startedAt: Date; endedAt: Date; minutes: number; count: number };

export function detectStops(points: TrackPt[]): TrackStop[] {
  const pts = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const n = pts.length;
  const stops: TrackStop[] = [];
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && haversineM(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng) <= STOP_RADIUS_M) j++;
    const durMs = pts[j - 1].at.getTime() - pts[i].at.getTime();
    if (durMs >= STOP_MIN_MS) {
      let sumLat = 0, sumLng = 0;
      for (let k = i; k < j; k++) { sumLat += pts[k].lat; sumLng += pts[k].lng; }
      const cnt = j - i;
      stops.push({ lat: sumLat / cnt, lng: sumLng / cnt, startedAt: pts[i].at, endedAt: pts[j - 1].at, minutes: Math.round(durMs / 60000), count: cnt });
      i = j;
    } else {
      i = j; // مرور واحد O(n): الانتقال إلى نقطة الكسر (يتحمّل آلاف النقاط في اليوم)
    }
  }
  return stops;
}

export async function attachNearestPoles<T extends { lat: number; lng: number }>(
  items: T[],
): Promise<(T & { pole: string | null; poleDistM: number | null })[]> {
  if (items.length === 0) return [];
  const pad = 0.02;
  const lats = items.map((s) => s.lat);
  const lngs = items.map((s) => s.lng);
  const poles = await prisma.mapPoint.findMany({
    where: {
      lat: { gte: Math.min(...lats) - pad, lte: Math.max(...lats) + pad },
      lng: { gte: Math.min(...lngs) - pad, lte: Math.max(...lngs) + pad },
    },
    take: 20000,
  });
  return items.map((s) => {
    let best: string | null = null, bestD = Infinity;
    for (const p of poles) {
      const d = haversineM(s.lat, s.lng, p.lat, p.lng);
      if (d < bestD) { bestD = d; best = p.name; }
    }
    const within = best != null && bestD <= 2000;
    return { ...s, pole: within ? best : null, poleDistM: within ? Math.round(bestD) : null };
  });
}

export async function purgeOldTrackPoints(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
  const res = await prisma.trackPoint.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}
