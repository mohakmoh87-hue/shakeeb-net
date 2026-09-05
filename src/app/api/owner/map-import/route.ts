import { NextResponse } from "next/server";
import zlib from "zlib";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";

// KMZ = أرشيفُ ZIP يحوي KML (طلبُ محمد 2026-09-05: اقبل KMZ أيضاً). نستخرج ملفَّ الـKML
// عبر الفهرس المركزيِّ للأرشيف ثمّ نفكّ ضغطَه (Node zlib.inflateRawSync — بلا مكتبةٍ خارجيّة).
export function kmzToKml(buf: Buffer): string {
  const EOCD = 0x06054b50; // نهايةُ الفهرس المركزيّ (PK\x05\x06)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ملف KMZ غير صالح (لا فهرس أرشيف)");
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  let best: { method: number; compSize: number; localOffset: number; name: string } | null = null;
  for (let i = 0; i < cdCount && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // ترويسةُ فهرسٍ مركزيّ
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (/\.kml$/i.test(name) && (!best || /(^|\/)doc\.kml$/i.test(name))) best = { method, compSize, localOffset, name };
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!best) throw new Error("KMZ لا يحوي ملفَّ KML");
  const lo = best.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error("ترويسةٌ محليّةٌ غير صالحة في KMZ");
  const lNameLen = buf.readUInt16LE(lo + 26);
  const lExtraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + lNameLen + lExtraLen;
  const comp = buf.subarray(dataStart, dataStart + best.compSize);
  // سقفُ الفكّ ٦٤م ب (خريطةُ أعمدةٍ أكبرُ من ذلك غيرُ واقعيّة) — يمنع قنبلةَ ضغطٍ تُرهق الخادم؛
  // التجاوزُ يرمي فيُمسَك في الأعلى كـ٤٠٠ لا يُسقط العمليّة.
  if (best.method !== 0 && best.method !== 8) throw new Error("ضغطُ KMZ غير مدعوم");
  const raw = best.method === 0
    ? comp.subarray(0, Math.min(comp.length, 64 * 1024 * 1024))
    : zlib.inflateRawSync(comp, { maxOutputLength: 64 * 1024 * 1024 });
  return raw.toString("utf8");
}

// ===== رفع خريطة الأعمدة (KML) — للمالك وحده (طلب محمد 2026-08-05) =====
// كانت الخرائط تُدخَل يدوياً على القاعدة، فكل تحديثٍ لمنطقة يحتاج تدخّلاً خارج البرنامج.
// الآن: يرفع المالك ملف KML (أو KMZ مفكوكاً) فتُقرأ علاماته وتُدرَج نقاطه — الجديد يُضاف
// والقديم يُحدَّث إحداثيّاته، ولا يُحذف شيء أبداً (خريطة ناقصة أهون من خريطة تُمحى بالخطأ).
//
// أسماء العلامات تُنقّى إلى صيغة القاعدة F{n}/{fdt}/{المنطقة}:
//  • "F10/64/ENT-C2/64/ENT" ⇒ نقطتان بنفس الإحداثي (العمود ونقطة الدعم)
//  • "C1/64/ENT-SUPPORT 1"  ⇒ C1/64/ENT
//  • "FDT64/ENT(R4)"        ⇒ FDT64/ENT
// والخطوط والمضلّعات تُتجاهَل: البرنامج يدلّ على عمودٍ لا على مسار كابل.

type Row = { name: string; lat: number; lng: number };

export function parseKml(xml: string): { rows: Row[]; skipped: number } {
  const rows: Row[] = [];
  let skipped = 0;
  const blocks = xml.match(/<Placemark[\s\S]*?<\/Placemark>/g) ?? [];
  for (const block of blocks) {
    const rawName = (block.match(/<name>([\s\S]*?)<\/name>/) ?? [])[1]?.trim() ?? "";
    const coord = (block.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/) ?? [])[1]?.trim();
    if (!coord || !rawName) { skipped++; continue; }
    const [lngS, latS] = coord.split(",");
    const lat = Number(latS);
    const lng = Number(lngS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { skipped++; continue; }

    const names = new Set<string>();
    const cleaned = rawName.replace(/\s*\(R\d+\)\s*$/i, "").trim();
    for (const part of cleaned.split(/-(?=[A-Za-z])/)) {
      const p = part.replace(/-?SUPPORT\s*\d*/i, "").trim();
      if (/^[A-Z]+\d*\/\d+\/[A-Z0-9]+$/i.test(p)) names.add(p.toUpperCase());
    }
    if (!names.size) { skipped++; continue; }
    for (const n of names) rows.push({ name: n, lat, lng });
  }
  // اسمٌ مكرّر في الملف نفسه: يُعتمد آخر ذكرٍ له
  const uniq = new Map<string, Row>();
  for (const r of rows) uniq.set(r.name, r);
  return { rows: [...uniq.values()], skipped };
}

export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const dryRun = body?.dryRun === true;
  let xml = typeof body?.kml === "string" ? body.kml : "";
  // KMZ (مضغوط): يصل base64 فيُفكّ إلى KML
  if (!xml && typeof body?.kmz === "string" && body.kmz) {
    try { xml = kmzToKml(Buffer.from(body.kmz, "base64")); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "تعذّرت قراءة ملف KMZ" }, { status: 400 }); }
  }
  if (!xml.includes("<Placemark")) {
    return NextResponse.json({ error: "الملف لا يحوي علامات (Placemark) — تأكّد أنه KML أو KMZ" }, { status: 400 });
  }

  const { rows, skipped } = parseKml(xml);
  if (!rows.length) {
    return NextResponse.json({ error: "لم يُعثر على نقطة واحدة بصيغة اسمٍ مفهومة (F1/64/ENT)" }, { status: 400 });
  }

  // ===== قاعدة الدمج (قرار محمد 2026-08-05) =====
  // • نقطة جديدة        ⇒ تُضاف.
  // • مكرّرة مصدرها kml  ⇒ **تُترك كما هي**: رفعُ ملفٍ مكرّر لا يحرّك ما ثبت من ملفٍ قبله.
  // • مكرّرة مصدرها tech ⇒ **يحلّ الملف محلّها**: الأولوية لخرائط المالك على ما سدّه فنيّ
  //   مؤقّتاً بموقع هاتفه. (وهذا الحدّ الوحيد الذي يُكتب فيه فوق نقطة قائمة.)
  const existing = await prisma.mapPoint.findMany({
    where: { name: { in: rows.map((r) => r.name) } },
    select: { name: true, lat: true, lng: true, source: true },
  });
  const byName = new Map(existing.map((e) => [e.name, e]));
  const added = rows.filter((r) => !byName.has(r.name));
  const overTech = rows.filter((r) => byName.get(r.name)?.source === "tech");
  const keptKml = rows.filter((r) => { const e = byName.get(r.name); return e != null && e.source !== "tech"; });
  const areas = [...new Set(rows.map((r) => r.name.split("/")[2] ?? "?"))];

  if (dryRun) {
    return NextResponse.json({
      ok: true, dryRun: true, points: rows.length,
      added: added.length, overTech: overTech.length, keptKml: keptKml.length,
      skipped, areas,
      sample: rows.slice(0, 8).map((r) => r.name),
      techNames: overTech.slice(0, 10).map((r) => r.name),
    });
  }

  const now = new Date();
  if (added.length) {
    await prisma.mapPoint.createMany({
      data: added.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, source: "kml", updatedAt: now })),
      skipDuplicates: true,
    });
  }
  for (const r of overTech) {
    await prisma.mapPoint.update({ where: { name: r.name }, data: { lat: r.lat, lng: r.lng, source: "kml", updatedAt: now } });
  }
  // keptKml: لا شيء — تُترك كما هي عمداً

  await prisma.auditLog.create({
    data: {
      userId: g.session.userId,
      action: "MAP_IMPORT", entity: "mapPoint", entityId: areas.join("،"),
      details:
        "رفع خريطة: " + rows.length + " نقطة (" + areas.join("، ") + ") — " +
        "جديدة " + added.length +
        " · حلّت محلّ نقاط أضافها فنيّون " + overTech.length +
        (overTech.length ? " (" + overTech.slice(0, 10).map((r) => r.name).join("، ") + ")" : "") +
        " · مكرّرة تُركت كما هي " + keptKml.length +
        " · علامات متجاهَلة (خطوط/أسماء غير مفهومة) " + skipped +
        " — لم تُحذف أي نقطة",
    },
  }).catch(() => { /* لا يُفشل الرفع بسبب القيد */ });

  const total = await prisma.mapPoint.count();
  return NextResponse.json({
    ok: true, points: rows.length, added: added.length, overTech: overTech.length, keptKml: keptKml.length,
    skipped, areas, total,
  });
}

// ملخّص الخريطة الحالية: كم نقطة في كل منطقة (ليعرف المالك ما لديه قبل الرفع)
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;
  const rows = await prisma.$queryRawUnsafe<{ area: string; c: bigint }[]>(
    "SELECT split_part(name, '/', 3) AS area, count(*) c FROM map_points GROUP BY 1 ORDER BY 2 DESC",
  );
  return NextResponse.json({
    areas: rows.filter((r) => r.area?.trim()).map((r) => ({ code: r.area, count: Number(r.c) })),
    total: rows.reduce((s, r) => s + Number(r.c), 0),
  });
}
