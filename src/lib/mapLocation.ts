import { prisma } from "@/lib/prisma";

// ===== ربط يوزر المشترك بموقع العمود في الخريطة =====
// صيغة اليوزر: bg-A-B-C@مكتب  ←  اسم العمود في الخريطة: F{B}/{A}/{منطقة}
// (الرقمان الأول والثاني يتبادلان، والرقم الثالث C = المنزل داخل العمود ولا يؤثّر على الموقع)

// المكتب (لاحقة اليوزر) ← رمز المنطقة في الخريطة
const OFFICE_AREA: Record<string, string> = {
  mu: "MWA",
  res: "SLM",
  shu: "SLM",
  mul: "MWA",
  mus: "MWA",
};
// مناطق احتياطية تُجرَّب عند عدم معرفة المكتب
const FALLBACK_AREAS = ["MWA", "SLM"];

// استخراج يوزر من نصّ حرّ (لبطاقات الفنيين المُدخَلة يدوياً)
export function extractNetUser(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/bg-\d+-\d+-\d+@\w+/i);
  return m ? m[0] : null;
}

// أسماء الأعمدة المرشّحة لهذا اليوزر (مرتّبة حسب أولوية المنطقة)
export function candidateColumnNames(netUser: string | null | undefined): string[] {
  if (!netUser) return [];
  const m = netUser.match(/^bg-(\d+)-(\d+)-\d+@(\w+)/i);
  if (!m) return [];
  const [, a, b, office] = m;
  const areas: string[] = [];
  const mapped = OFFICE_AREA[office.toLowerCase()];
  if (mapped) areas.push(mapped);
  for (const f of FALLBACK_AREAS) if (!areas.includes(f)) areas.push(f);
  // العمود = F{B}/{A}/{منطقة}
  return areas.map((area) => `F${b}/${a}/${area}`.toUpperCase());
}

export type MapLoc = { name: string; lat: number; lng: number };

// موقع مشترك من يوزره (يبحث في map_points عن أول عمود مرشّح موجود)
export async function resolveLocation(netUser: string | null | undefined): Promise<MapLoc | null> {
  const names = candidateColumnNames(netUser);
  if (names.length === 0) return null;
  const rows = await prisma.mapPoint.findMany({ where: { name: { in: names } }, select: { name: true, lat: true, lng: true } });
  if (rows.length === 0) return null;
  // أعِد أول اسم مرشّح موجود (حسب أولوية المنطقة)
  for (const n of names) {
    const hit = rows.find((r) => r.name === n);
    if (hit) return hit;
  }
  return rows[0];
}

// روابط الملاحة
export function gmapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
export function wazeUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}
