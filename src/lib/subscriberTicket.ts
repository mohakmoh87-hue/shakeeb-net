import { prisma } from "@/lib/prisma";

// إنشاءٌ كسولٌ للجدول (النشرُ لا يُشغّل migrate) — تحصينٌ ضدّ التعافي، بنفس نمط company_users.
let ticketsTableReady = false;
export async function ensureSubscriberTicketsTable(): Promise<void> {
  if (ticketsTableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "subscriber_tickets" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "phone" TEXT NOT NULL,
      "area" TEXT,
      "note" TEXT,
      "lat" DOUBLE PRECISION,
      "lng" DOUBLE PRECISION,
      "nearestPole" TEXT,
      "poleDistanceM" DOUBLE PRECISION,
      "towerId" INTEGER,
      "agentId" INTEGER,
      "subscriberId" INTEGER,
      "type" TEXT,
      "status" TEXT NOT NULL DEFAULT 'new',
      "source" TEXT NOT NULL DEFAULT 'app',
      "handledById" INTEGER,
      "handledAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "subscriber_tickets" ADD COLUMN IF NOT EXISTS "subscriberId" INTEGER`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "subscriber_tickets" ADD COLUMN IF NOT EXISTS "type" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "subscriber_tickets" ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "subscriber_tickets" ADD COLUMN IF NOT EXISTS "raisedById" INTEGER`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "subscriber_tickets" ADD COLUMN IF NOT EXISTS "reply" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "subscriber_tickets" ADD COLUMN IF NOT EXISTS "repliedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "subscriber_tickets_agentId_status_idx" ON "subscriber_tickets" ("agentId", "status")`);
  ticketsTableReady = true;
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export type TicketLoc = {
  nearestPole: string | null;
  poleDistanceM: number | null;
  towerId: number | null;
  agentId: number | null;
};

// أقربُ عامودٍ للموقع ← منطقتُه (الجزء الثالث من اسمه، مثل MWA) ← المكتب (Tower.mapArea) ← الوكيل.
// وكيلٌ واحدٌ للمنطقة ⇒ يُوجَّه إليه؛ صفرٌ أو أكثرُ من وكيل ⇒ بلا وكيل (سوبر سيل فقط) — لا يُخمَّن وكيل.
export async function resolveTicketLocation(lat: number | null, lng: number | null): Promise<TicketLoc> {
  const empty: TicketLoc = { nearestPole: null, poleDistanceM: null, towerId: null, agentId: null };
  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return empty;
  const box = 0.2; // صندوقٌ حاصرٌ ~٢٢كم؛ خارجَه لا نُوجّه
  const poles = await prisma.mapPoint.findMany({
    where: { lat: { gte: lat - box, lte: lat + box }, lng: { gte: lng - box, lte: lng + box } },
    select: { name: true, lat: true, lng: true },
  });
  if (poles.length === 0) return empty;
  let best = poles[0];
  let bestD = distanceMeters(lat, lng, best.lat, best.lng);
  for (const p of poles) {
    const d = distanceMeters(lat, lng, p.lat, p.lng);
    if (d < bestD) { best = p; bestD = d; }
  }
  const area = (best.name.split("/")[2] ?? "").toUpperCase();
  let towerId: number | null = null;
  let agentId: number | null = null;
  if (area) {
    const towers = await prisma.tower.findMany({
      where: { isDeleted: false, mapArea: { equals: area, mode: "insensitive" } },
      select: { id: true, agentId: true },
    });
    const agents = [...new Set(towers.map((t) => t.agentId).filter((a): a is number => a != null))];
    if (agents.length === 1) {
      agentId = agents[0];
      towerId = towers.find((t) => t.agentId === agentId)?.id ?? null;
    }
  }
  return { nearestPole: best.name, poleDistanceM: Math.round(bestD), towerId, agentId };
}

// ═════ احتياطُ «أقرب وكيل» (معالجةُ اليتيم — طلبُ محمد 2026-09-01) ═════
// حين تعذّر تحديدُ وكيلٍ من المنطقة (agentId=null، منطقةٌ مشتركةٌ أو بلا مكتب) **والبوّابةُ مطفأة**
// (لا سوبر سيل يستقبلُ اليتيم): نأخذ وكيلَ **أقرب مكتبٍ جغرافيّاً** للمشترك (من المكاتب ذات
// الإحداثيّات ضمن ~٥٥كم) — «العامودُ تابعٌ لأقرب مكتب». فلا تُيتَّم تذكرةُ التسجيل. صفرٌ عند
// عدم وجود مكتبٍ قريبٍ بإحداثيّات. لا يُستعمَل والبوّابةُ مُشعَلة (اليتيمُ يذهبُ لسوبر سيل يدويّاً).
export async function nearestAgentByOffice(lat: number | null, lng: number | null): Promise<{ towerId: number; agentId: number } | null> {
  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;
  const box = 0.5; // ~٥٥كم — نطاقُ خدمةٍ معقول
  const towers = await prisma.tower.findMany({
    where: { isDeleted: false, agentId: { not: null }, lat: { gte: lat - box, lte: lat + box }, lng: { gte: lng - box, lte: lng + box } },
    select: { id: true, agentId: true, lat: true, lng: true },
  });
  let best: { id: number; agentId: number } | null = null;
  let bestD = Infinity;
  for (const t of towers) {
    if (t.lat == null || t.lng == null || t.agentId == null) continue;
    const d = distanceMeters(lat, lng, t.lat, t.lng);
    if (d < bestD) { bestD = d; best = { id: t.id, agentId: t.agentId }; }
  }
  return best ? { towerId: best.id, agentId: best.agentId } : null;
}
