import { prisma } from "@/lib/prisma";
import { candidateColumnNames, areaFromTowerName } from "@/lib/mapLocation";

// ═════ 🗺️ إسنادُ موقعٍ ← الوكيل المالك (طلبُ محمد 2026-09-06) ═════
// المالكُ = الوكيلُ صاحبُ أكثر مشتركين على أعمدة **خليّة الشبكة** (٣٠٠م) فعليّاً (يوزرُ المشترك
// ← اسمُ عموده عبر candidateColumnNames ← خليّتُه). ارتدادٌ لطريقة المنطقة (Tower.mapArea ←
// وكيلٌ وحيد) للخلايا بلا مشتركين. فهرسٌ مبنيٌّ مرّةً كلَّ ١٠د (كاش).
//
// 🔒 **الخصوصيّةُ الحرِجة**: الإسنادُ والمطابقةُ يجريان على **مراكز الخلايا المُعلَنة في GET**
// لا على مواقع الأعمدة الخام — فإشارةُ «هل لموقعك مالك؟» لا تتجاوز دقّةَ الشبكة (٣٠٠م) التي
// يكشفها GET أصلاً، ويستحيلُ استرجاعُ إحداثيّات عمودٍ بمسحٍ ثنائيٍّ للحدّ (خطأُ نصفِ القطر الخام).

export const CELL_M = 300; // حجمُ خليّة الشبكة (ونصفُ قطر «داخل التغطية»)
const REF_LAT = 33.3; // بغداد — لتثبيت شبكةٍ منتظمة
export const LAT_CELL = CELL_M / 111_320;
export const LNG_CELL = CELL_M / (111_320 * Math.cos((REF_LAT * Math.PI) / 180));

type Owner = { agentId: number; towerId: number };
export type OfficeInfo = { name: string; phone: string | null; lat: number | null; lng: number | null };
type Cell = { lat: number; lng: number; owner: Owner; area: string | null }; // مركزٌ + مالك (الخلايا المملوكة فقط)

type Index = {
  at: number;
  cells: [number, number][]; // مراكزُ كلّ الخلايا المأهولة (للـGET والـinside) — بلا أعمدة
  ownedCells: Cell[]; // الخلايا التي لها مالكٌ فقط (لتحديد المالك بالموقع)
  offices: Map<number, OfficeInfo>;
};

let idx: Index | null = null;
const TTL = 10 * 60_000;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

async function getIndex(): Promise<Index> {
  if (idx && Date.now() - idx.at < TTL) return idx;

  // الأعمدة ← خلاياها (لا تُحفَظ إحداثيّاتُ العمود؛ فقط مركزُ الخليّة ومنطقتُها)
  const polesRaw = await prisma.mapPoint.findMany({ select: { name: true, lat: true, lng: true } });
  const poleCell = new Map<string, string>(); // اسمُ العمود (UPPER) ← مفتاحُ الخليّة
  const cellCenter = new Map<string, [number, number]>();
  const cellArea = new Map<string, string>();
  for (const p of polesRaw) {
    if (p.lat == null || p.lng == null) continue;
    const ci = Math.round(p.lat / LAT_CELL), cj = Math.round(p.lng / LNG_CELL);
    const key = `${ci}|${cj}`;
    poleCell.set(p.name.toUpperCase(), key);
    if (!cellCenter.has(key)) cellCenter.set(key, [Number((ci * LAT_CELL).toFixed(5)), Number((cj * LNG_CELL).toFixed(5))]);
    if (!cellArea.has(key)) { const a = (p.name.split("/")[2] ?? "").toUpperCase(); if (a) cellArea.set(key, a); }
  }

  const towers = await prisma.tower.findMany({
    where: { isDeleted: false },
    select: { id: true, agentId: true, mapArea: true, name: true, phone: true, lat: true, lng: true },
  });
  const towerMap = new Map<number, { agentId: number | null; mapArea: string | null; name: string | null }>();
  const offices = new Map<number, OfficeInfo>();
  for (const t of towers) {
    towerMap.set(t.id, { agentId: t.agentId, mapArea: t.mapArea, name: t.name });
    offices.set(t.id, { name: t.name ?? "مكتب", phone: t.phone ?? null, lat: t.lat, lng: t.lng });
  }

  // ارتدادُ المنطقة: رمزٌ ← وكيلٌ وحيدٌ فقط (مطابقٌ لمنطق resolveTicketLocation)
  const areaSets = new Map<string, Set<number>>();
  for (const t of towers) {
    if (t.agentId == null || !t.mapArea) continue;
    const a = t.mapArea.toUpperCase();
    if (!areaSets.has(a)) areaSets.set(a, new Set());
    areaSets.get(a)!.add(t.agentId);
  }
  const areaAgents = new Map<string, Owner | null>();
  for (const [a, set] of areaSets) {
    if (set.size === 1) {
      const agentId = [...set][0];
      const tw = towers.find((t) => t.agentId === agentId && t.mapArea?.toUpperCase() === a);
      areaAgents.set(a, tw ? { agentId, towerId: tw.id } : null);
    } else areaAgents.set(a, null);
  }

  // بمشتركي الخليّة: عدُّ مشتركي كلِّ وكيلٍ في كلِّ خليّة، والمالكُ = الأكثر
  const subs = await prisma.subscriber.findMany({
    where: { isDeleted: false, netUser: { not: null }, towerId: { not: null } },
    select: { netUser: true, towerId: true },
  });
  const counts = new Map<string, Map<number, { count: number; towers: Map<number, number> }>>();
  for (const s of subs) {
    const tw = s.towerId != null ? towerMap.get(s.towerId) : undefined;
    if (!tw || tw.agentId == null) continue;
    const areaHint = tw.mapArea ?? areaFromTowerName(tw.name);
    let cellKey: string | null = null;
    for (const c of candidateColumnNames(s.netUser, areaHint)) {
      const k = poleCell.get(c);
      if (k) { cellKey = k; break; }
    }
    if (!cellKey) continue;
    if (!counts.has(cellKey)) counts.set(cellKey, new Map());
    const am = counts.get(cellKey)!;
    if (!am.has(tw.agentId)) am.set(tw.agentId, { count: 0, towers: new Map() });
    const rec = am.get(tw.agentId)!;
    rec.count++;
    rec.towers.set(s.towerId!, (rec.towers.get(s.towerId!) ?? 0) + 1);
  }

  const cells: [number, number][] = [];
  const ownedCells: Cell[] = [];
  for (const [key, center] of cellCenter) {
    cells.push(center);
    let owner: Owner | null = null;
    const am = counts.get(key);
    if (am) {
      let bestAgent = -1, bestCount = -1, bestTower = -1;
      for (const [agentId, rec] of am) {
        if (rec.count > bestCount || (rec.count === bestCount && agentId < bestAgent)) {
          bestCount = rec.count; bestAgent = agentId;
          let tc = -1, tid = -1;
          for (const [id, c] of rec.towers) { if (c > tc) { tc = c; tid = id; } }
          bestTower = tid;
        }
      }
      if (bestAgent >= 0 && bestTower >= 0) owner = { agentId: bestAgent, towerId: bestTower };
    }
    if (!owner) { const a = cellArea.get(key); if (a) owner = areaAgents.get(a) ?? null; }
    if (owner) ownedCells.push({ lat: center[0], lng: center[1], owner, area: cellArea.get(key) ?? null });
  }

  idx = { at: Date.now(), cells, ownedCells, offices };
  return idx;
}

// مراكزُ الخلايا للـGET (والـinside) — لا أعمدةَ إطلاقاً
export async function getCoverageCells(): Promise<[number, number][]> {
  return (await getIndex()).cells;
}

export type CoverageOwner = { agentId: number; towerId: number; area: string | null; office: OfficeInfo };

// المالكُ لموقعٍ = مالكُ أقربِ **خليّةٍ مملوكةٍ** مركزُها ضمن CELL_M (كاختبار inside تماماً).
// null ⇒ لا مالك (خارج التغطية أو خليّةٌ بلا مالك) ⇒ التطبيقُ يعرض 6033/تذكرة.
export async function resolveCoverageOwner(lat: number, lng: number): Promise<CoverageOwner | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const index = await getIndex();
  const dLat = CELL_M / 111_320, dLng = CELL_M / (111_320 * Math.cos(rad(lat)));
  let best: Cell | null = null;
  let bestD = Infinity;
  for (const c of index.ownedCells) {
    if (Math.abs(c.lat - lat) > dLat || Math.abs(c.lng - lng) > dLng) continue;
    const d = haversine(lat, lng, c.lat, c.lng);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best || bestD > CELL_M) return null;
  const office = index.offices.get(best.owner.towerId) ?? { name: "مكتب", phone: null, lat: null, lng: null };
  return { agentId: best.owner.agentId, towerId: best.owner.towerId, area: best.area, office };
}
