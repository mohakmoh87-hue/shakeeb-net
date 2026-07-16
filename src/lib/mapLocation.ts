import { prisma } from "@/lib/prisma";

// ===== ربط يوزر المشترك بموقع العمود في الخريطة =====
// كل اليوزرات تبدأ بـ bg. الصيغة: bg-A-B-C  ←  اسم العمود: F{B}/{A}/{منطقة}
// (الرقمان الأول والثاني يتبادلان، والرقم الثالث C غير مهمّ للموقع)
// المنطقة تُؤخذ من مكتب المشترك: المواصلات(mu)→MWA، الرسالة(res)/الشهداء(shu)→SLM.

// المكتب (لاحقة اليوزر) ← رمز المنطقة
const OFFICE_AREA: Record<string, string> = {
  mu: "MWA", res: "SLM", shu: "SLM", mul: "MWA", mus: "MWA",
};
const FALLBACK_AREAS = ["MWA", "SLM"];

// منطقة الخريطة من اسم المكتب (البرج)
export function areaFromTowerName(name: string | null | undefined): string | null {
  const n = name ?? "";
  if (n.includes("مواصلات")) return "MWA";
  if (n.includes("رسالة") || n.includes("الرساله")) return "SLM";
  if (n.includes("شهداء")) return "SLM";
  return null;
}

// استخراج يوزر من نصّ حرّ (لبطاقات الفنيين) — يتطلّب بادئة bg لتفادي التقاط أرقام الهاتف
export function extractNetUser(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/bg[-\s]*\d+[-\s]*\d+(?:[-\s]*\d+)?(?:@\w+)?/i);
  return m ? m[0] : null;
}

// أول رقمين (A,B) من اليوزر بمرونة — يقبل bg-1-2-3@mu أو bg-1-2 أو حتى 1-2
function parseAB(netUser: string | null | undefined): { a: string; b: string } | null {
  if (!netUser) return null;
  const m = netUser.match(/(\d+)\s*[-–]\s*(\d+)/); // أول رقمين مفصولين بشرطة
  if (!m) return null;
  return { a: m[1], b: m[2] };
}

// لاحقة المكتب من اليوزر (إن وُجدت @)
function officeSuffix(netUser: string | null | undefined): string | null {
  const m = (netUser ?? "").match(/@(\w+)/);
  return m ? m[1].toLowerCase() : null;
}

// أسماء الأعمدة المرشّحة. areaHint (من مكتب المشترك) له الأولوية.
export function candidateColumnNames(netUser: string | null | undefined, areaHint?: string | null): string[] {
  const ab = parseAB(netUser);
  if (!ab) return []; // شاذ: لا رقمين ⇒ لا موقع
  const areas: string[] = [];
  if (areaHint) areas.push(areaHint.toUpperCase());
  const suf = officeSuffix(netUser);
  if (suf && OFFICE_AREA[suf]) areas.push(OFFICE_AREA[suf]);
  for (const f of FALLBACK_AREAS) if (!areas.includes(f)) areas.push(f);
  const uniq = [...new Set(areas)];
  return uniq.map((area) => `F${ab.b}/${ab.a}/${area}`.toUpperCase());
}

export type MapLoc = { name: string; lat: number; lng: number };

// موقع من يوزر (+ تلميح منطقة من المكتب) — يبحث في map_points عن أول عمود مرشّح
export async function resolveLocation(netUser: string | null | undefined, areaHint?: string | null): Promise<MapLoc | null> {
  const names = candidateColumnNames(netUser, areaHint);
  if (names.length === 0) return null;
  const rows = await prisma.mapPoint.findMany({ where: { name: { in: names } }, select: { name: true, lat: true, lng: true } });
  if (rows.length === 0) return null;
  for (const n of names) {
    const hit = rows.find((r) => r.name === n);
    if (hit) return hit;
  }
  return rows[0];
}

export function gmapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
export function wazeUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}
