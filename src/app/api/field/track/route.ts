import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// تتبع الموقع بالطلب: صفحة التتبع تبعث «نبضة» كل 30ث تجدّد trackReqAt؛
// هاتف الفني يرسل موقعه كل دقيقة ما دامت النبضة طازجة. لا سجل تاريخي:
// كل تحديث يستبدل السابق، والإيقاف يمسح الموقع نهائياً.
const FRESH_MS = 90_000; // نبضة أقدم من 90ث = التتبع متوقف (أمان عند انقطاع صفحة التتبع)

const isFresh = (d: Date | null) => !!d && Date.now() - d.getTime() < FRESH_MS;

// الفنيون المطلوبون بعد تحقق الملكية (المدير: مكاتب وكيله؛ مستخدم المكتب: مكتبه فقط)
async function ownedTechs(ids: number[]) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  const techs = await prisma.technician.findMany({
    where: { id: { in: ids }, isDeleted: false },
    select: { id: true, name: true, towerId: true, trackReqAt: true, trackLat: true, trackLng: true, trackAt: true },
  });
  // العزل: المدير ⇒ مكاتب وكيله فقط؛ مستخدم المكتب ⇒ مكتبه فقط (ownsTower يفحص الاثنين)
  const allowed = [] as typeof techs;
  for (const t of techs) if (await ownsTower(session, t.towerId)) allowed.push(t);
  if (allowed.length === 0) return { error: NextResponse.json({ error: "لا فنيين ضمن صلاحيتك" }, { status: 403 }) };
  return { session, techs: allowed };
}

const idsSchema = z.object({ technicianIds: z.array(z.coerce.number()).min(1).max(100) });

// GET (فني): هل التتبع مطلوب منّي الآن؟ — فحص خفيف كل 30ث من التطبيق
export async function GET() {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { trackReqAt: true } });
  return NextResponse.json({ tracking: isFresh(t?.trackReqAt ?? null) });
}

// PUT (مدير/مستخدم المكتب): نبضة تتبع لفنيين محدّدين + إرجاع مواقعهم الحالية
export async function PUT(request: Request) {
  const parsed = idsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "technicianIds مطلوبة" }, { status: 400 });
  const r = await ownedTechs(parsed.data.technicianIds);
  if ("error" in r) return r.error;
  const now = new Date();
  await prisma.technician.updateMany({ where: { id: { in: r.techs.map((t) => t.id) } }, data: { trackReqAt: now } });
  return NextResponse.json({
    ok: true,
    locations: r.techs.map((t) => ({
      id: t.id, name: t.name,
      lat: t.trackLat, lng: t.trackLng,
      at: t.trackAt, fresh: !!t.trackAt && now.getTime() - t.trackAt.getTime() < 3 * 60_000,
    })),
  });
}

// إيقاف التتبع: مسح النبضة وآخر موقع نهائياً من القاعدة
async function stopTracking(ids: number[]) {
  const r = await ownedTechs(ids);
  if ("error" in r) return r.error;
  await prisma.technician.updateMany({
    where: { id: { in: r.techs.map((t) => t.id) } },
    data: { trackReqAt: null, trackLat: null, trackLng: null, trackAt: null },
  });
  return NextResponse.json({ ok: true, stopped: r.techs.length });
}

// DELETE (مدير/مستخدم المكتب): إيقاف تتبع فنيين (عند إلغاء تحديد أو إغلاق النافذة)
export async function DELETE(request: Request) {
  const parsed = idsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "technicianIds مطلوبة" }, { status: 400 });
  return stopTracking(parsed.data.technicianIds);
}

// POST:
// - فني: {lat,lng} → حفظ موقعه (استبدال السابق) إن كانت النبضة طازجة، وإلا مسح وإيقاف
// - مدير (sendBeacon عند إغلاق الصفحة): {action:"stop", technicianIds} → إيقاف نهائي
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const tech = await getTechSession();
  if (tech) {
    const parsed = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "إحداثيات غير صحيحة" }, { status: 400 });
    const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { trackReqAt: true } });
    if (!isFresh(t?.trackReqAt ?? null)) {
      // التتبع لم يعُد مطلوباً — امسح أي أثر وأبلغ التطبيق بالتوقف
      await prisma.technician.update({ where: { id: tech.technicianId }, data: { trackReqAt: null, trackLat: null, trackLng: null, trackAt: null } });
      return NextResponse.json({ tracking: false });
    }
    await prisma.technician.update({
      where: { id: tech.technicianId },
      data: { trackLat: parsed.data.lat, trackLng: parsed.data.lng, trackAt: new Date() }, // استبدال كامل — لا تاريخ
    });
    return NextResponse.json({ tracking: true });
  }

  // إيقاف عبر sendBeacon من صفحة التتبع (POST لأن beacon لا يدعم DELETE)
  const stop = z.object({ action: z.literal("stop"), technicianIds: z.array(z.coerce.number()).min(1).max(100) }).safeParse(body);
  if (stop.success) return stopTracking(stop.data.technicianIds);
  return NextResponse.json({ error: "طلب غير صحيح" }, { status: 400 });
}
