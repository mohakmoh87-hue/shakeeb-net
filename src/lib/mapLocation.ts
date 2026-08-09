import { prisma } from "@/lib/prisma";

// ===== ربط يوزر المشترك بموقع العمود في الخريطة =====
// كل اليوزرات تبدأ بـ bg. الصيغة: bg-A-B-C (A=FDT، B=FAT) ← اسم العمود: F{FAT}/{FDT}/{منطقة}
// **قاعدة محمد النهائيّة (2026-08-08): «الصحيح هو fat/fdt»** — أي bg-7-26 ⇒ F26/7.
// (يطابق أسماء الخريطة المستوردة: F26/7/MWA موجودة.) عمودٌ غير موجود ⇒ null
// («موقع هذا اليوزر غير موجود في الخريطة» + خيار إرسال موقع العمود من الفنيّ).
// المنطقة تُؤخذ من مكتب المشترك: المواصلات(mu)→MWA، الرسالة(res)/الشهداء(shu)→SLM.

// المكتب (لاحقة اليوزر) ← رمز المنطقة
// المواصلات(mu)→MWA، الشهداء(shu)→SLM، الرسالة(res)→ENT
const OFFICE_AREA: Record<string, string> = {
  mu: "MWA", shu: "SLM", res: "ENT", mul: "MWA", mus: "MWA",
};
const FALLBACK_AREAS = ["MWA", "SLM", "ENT"];

// منطقة الخريطة من اسم المكتب (البرج)
export function areaFromTowerName(name: string | null | undefined): string | null {
  const n = name ?? "";
  if (n.includes("مواصلات")) return "MWA";
  if (n.includes("شهداء")) return "SLM";
  if (n.includes("رسالة") || n.includes("الرساله")) return "ENT";
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
  // منطقة المكتب حاسمة: إن عُرفت نستخدمها وحدها (تفادياً لموقع خاطئ من منطقة أخرى).
  let areas: string[];
  const suf = officeSuffix(netUser);
  if (areaHint) areas = [areaHint.toUpperCase()];
  else if (suf && OFFICE_AREA[suf]) areas = [OFFICE_AREA[suf]];
  else areas = [...FALLBACK_AREAS];
  return [...new Set(areas)].map((area) => `F${ab.b}/${ab.a}/${area}`.toUpperCase());
}

// ===== بديلٌ عن اليوزر: FDT/FAT من نصّ البطاقة (طلب محمد 2026-08-09) =====
// بطاقات أودو قد تصل **بلا يوزر (bg)** لكن فيها FDT وFAT صريحَين — فيُبنى اسم العمود منهما
// بنفس القاعدة: `F{FAT}/{FDT}/{منطقة المكتب}`. يدعم صيغتَي سطر البطاقة:
//   «🗺️ FDT: 7 · FAT: 26»  (الصيغة الحاليّة)   و   «FDT/FAT: 7 / 26» (الصيغة القديمة).
export function extractFdtFat(text?: string | null): { fdt: string; fat: string } | null {
  if (!text) return null;
  let m = text.match(/FDT\s*[:：]\s*(\d+)[\s\S]{0,15}?FAT\s*[:：]\s*(\d+)/i);
  if (m) return { fdt: m[1], fat: m[2] };
  m = text.match(/FDT\s*\/\s*FAT\s*[:：]\s*(\d+)\s*\/\s*(\d+)/i);
  if (m) return { fdt: m[1], fat: m[2] };
  return null;
}

// أسماء الأعمدة المرشّحة من FDT/FAT مباشرةً — نفس قاعدة اليوزر حرفيّاً: F{FAT}/{FDT}/{المنطقة}
export function candidateColumnNamesFromFdtFat(fdt: string, fat: string, areaHint?: string | null): string[] {
  if (!/^\d+$/.test(fdt) || !/^\d+$/.test(fat)) return [];
  const areas = areaHint ? [areaHint.toUpperCase()] : [...FALLBACK_AREAS];
  return [...new Set(areas)].map((area) => `F${fat}/${fdt}/${area}`.toUpperCase());
}

export type MapLoc = { name: string; lat: number; lng: number };

// موقعٌ من قائمة أسماء أعمدةٍ مرشّحة (مشتركة بين مسار اليوزر ومسار FDT/FAT)
export async function resolveLocationByNames(names: string[]): Promise<MapLoc | null> {
  if (names.length === 0) return null;
  const rows = await prisma.mapPoint.findMany({ where: { name: { in: names } }, select: { name: true, lat: true, lng: true } });
  if (rows.length === 0) return null;
  for (const n of names) {
    const hit = rows.find((r) => r.name === n);
    if (hit) return hit;
  }
  return rows[0];
}

// موقع من يوزر (+ تلميح منطقة من المكتب) — يبحث في map_points عن أول عمود مرشّح
export async function resolveLocation(netUser: string | null | undefined, areaHint?: string | null): Promise<MapLoc | null> {
  return resolveLocationByNames(candidateColumnNames(netUser, areaHint));
}

export function gmapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
export function wazeUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}
