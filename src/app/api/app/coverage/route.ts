import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { resolveCoverageOwner, getCoverageOffices, CELL_M, LAT_CELL, LNG_CELL } from "@/lib/coverageOwners";
import { towerHoursMap } from "@/lib/officeHours";

export const dynamic = "force-dynamic";

// ═════ 📡🗺️ أماكنُ تغطية سوبر سيل — للتطبيق (طلب محمد 2026-09-06) ═════
// GET: ظلُّ التغطية الشفّاف — خلايا شبكةٍ (٣٠٠م) فيها عمودٌ واحدٌ على الأقلّ. **لا تُرجَع مواقعُ
//   الأعمدة إطلاقاً**: تُسنَد كلُّ نقطةٍ إلى مركز خليّتها فتُخفى النقطةُ الفعليّة (±٣٠٠م).
//   ومعها **مواقعُ المكاتب** بأسمائها وهواتفها العامّة (طلبُ محمد 2026-10-26) — واجهةُ
//   محلٍّ وهاتفٌ معلَن، وهي الحقولُ نفسُها التي يكشفها POST للمكتب المالك.
// POST {lat,lng}: هل الموقعُ داخل التغطية؟ + أقربُ مكتبٍ (هاتفُه وموقعُه) — كلُّه معلوماتٌ عامّة.

// شبكةُ الخلايا (CELL_M/LAT_CELL/LNG_CELL) مصدرُها الوحيد coverageOwners — كي يتطابق «داخل
// التغطية» مع إسناد المالك على الشبكة نفسِها.
type Cache = { at: number; cells: [number, number][] };
let cache: Cache | null = null;
const TTL = 10 * 60_000;

async function getCoverage(): Promise<Cache> {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const poles = await prisma.mapPoint.findMany({ select: { lat: true, lng: true } });
  const seen = new Set<string>();
  const cells: [number, number][] = [];
  for (const p of poles) {
    if (p.lat == null || p.lng == null) continue;
    const ci = Math.round(p.lat / LAT_CELL), cj = Math.round(p.lng / LNG_CELL);
    const key = `${ci}|${cj}`;
    if (!seen.has(key)) { seen.add(key); cells.push([Number((ci * LAT_CELL).toFixed(5)), Number((cj * LNG_CELL).toFixed(5))]); }
  }
  cache = { at: Date.now(), cells };
  return cache;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export async function GET() {
  const [cov, offices] = await Promise.all([getCoverage(), getCoverageOffices()]);
  // 🕘 أوقاتُ العمل مع كلّ مكتب (طلبُ محمد 2026-10-28) — ولا يُعاد `towerId` نفسُه.
  const hours = await towerHoursMap(offices.map((o) => o.towerId));
  return NextResponse.json({
    cellM: CELL_M,
    cells: cov.cells,
    offices: offices.map((o) => ({ name: o.name, phone: o.phone, lat: o.lat, lng: o.lng, hours: hours.get(o.towerId) ?? "" })),
  });
}

export async function POST(request: Request) {
  if (!rateLimit(`coverage-check:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة — انتظر قليلاً" }, { status: 429 });
  }
  const b = await request.json().catch(() => null);
  const lat = Number(b?.lat), lng = Number(b?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "موقعٌ غير صالح" }, { status: 400 });

  const cov = await getCoverage();
  // 🔒 يُقاس «داخل التغطية» من **مراكز الخلايا المُعلَنة في GET** لا من مواقع الأعمدة الخام،
  // فلا يكشف POST شيئاً زائداً عمّا يكشفه GET (يستحيل استرجاعُ موقع عمودٍ بمسحٍ ثنائيٍّ للحدّ).
  const dLatMax = CELL_M / 111_320, dLngMax = CELL_M / (111_320 * Math.cos(rad(lat)));
  let inside = false;
  for (const c of cov.cells) {
    if (Math.abs(c[0] - lat) > dLatMax || Math.abs(c[1] - lng) > dLngMax) continue;
    if (haversine(lat, lng, c[0], c[1]) <= CELL_M) { inside = true; break; }
  }

  // 🗺️ المكتبُ **المالكُ** لعمود الموقع (بمشتركيه فعليّاً ثمّ بالمنطقة) — لا «أقرب مكتب».
  // هاتفُ المكتب العامُّ فقط (phone)، لا managerPhone (داخليٌّ) على مسارٍ عامّ.
  // 🔁 ومعه **أقربُ مكتبٍ جغرافيّاً** حين يختلف عنه (قرارُ محمد 2026-10-28): المالكُ يبقى
  //    هو مَن يُرفَع إليه الطلبُ — فهو الذي يخدم الشارعَ فعلاً — والأقربُ يُعرَض للعلم
  //    وحدَه، فلا يضيع التوجيهُ الصحيح ولا يُحيَّر الزبونُ بمكتبٍ بعيدٍ بلا تفسير.
  const own = await resolveCoverageOwner(lat, lng);
  const offices = await getCoverageOffices();
  const hours = await towerHoursMap([
    ...(own ? [own.towerId] : []),
    ...offices.map((o) => o.towerId),
  ]);
  const card = (o: { name: string; phone: string | null; lat: number | null; lng: number | null }, towerId: number) => ({
    name: o.name, phone: o.phone, lat: o.lat, lng: o.lng,
    distanceM: o.lat != null && o.lng != null ? Math.round(haversine(lat, lng, o.lat, o.lng)) : null,
    hours: hours.get(towerId) ?? "",
  });

  const owner = own ? card(own.office, own.towerId) : null;

  let nearest: ReturnType<typeof card> | null = null;
  let bestD = Infinity;
  for (const o of offices) {
    if (own && o.towerId === own.towerId) continue; // المالكُ معروضٌ أصلاً
    const d = haversine(lat, lng, o.lat as number, o.lng as number);
    if (d < bestD) { bestD = d; nearest = card(o, o.towerId); }
  }

  return NextResponse.json({ inside, owner, nearest });
}
