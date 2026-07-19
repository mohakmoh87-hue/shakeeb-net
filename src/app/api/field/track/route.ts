import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { sendFcmData } from "@/lib/fcm";

export const dynamic = "force-dynamic";

// تتبع الموقع بالطلب: صفحة التتبع تبعث «نبضة» كل 30ث تجدّد trackReqAt؛
// هاتف الفني يرسل موقعه ما دامت النبضة طازجة. لا سجل تاريخي: كل تحديث يستبدل السابق.
// الإيقاف يمسح النبضة فقط ويُبقي «آخر موقع حيّ» (يُعرض عند إعادة الفتح مع وقته/طزاجته).
const FRESH_MS = 90_000; // نبضة أقدم من 90ث = التتبع متوقف (أمان عند انقطاع صفحة التتبع)

const isFresh = (d: Date | null) => !!d && Date.now() - d.getTime() < FRESH_MS;

// إيقاظ/إيقاف خدمة التتبع الأصلية عبر FCM. cmd: "track-start" | "track-stop".
// يُرسَل فقط لمن لديه رمز جهاز؛ الرموز الباطلة تُمسَح. لا يعطّل شيئاً إن كان FCM غير مُفعَّل.
type WakeTech = { id: number; fcmToken: string | null };
async function wakeTechs(techs: WakeTech[], cmd: "track-start" | "track-stop") {
  const targets = techs.filter((t) => t.fcmToken);
  if (targets.length === 0) return;
  await Promise.all(
    targets.map(async (t) => {
      const r = await sendFcmData(t.fcmToken, { cmd });
      if (r.invalidToken) {
        await prisma.technician.update({ where: { id: t.id }, data: { fcmToken: null } }).catch(() => {});
      }
    }),
  );
}

// الفنيون المطلوبون بعد تحقق الملكية (المدير: مكاتب وكيله؛ مستخدم المكتب: مكتبه فقط)
async function ownedTechs(ids: number[]) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  const techs = await prisma.technician.findMany({
    where: { id: { in: ids }, isDeleted: false },
    select: { id: true, name: true, towerId: true, trackReqAt: true, trackLat: true, trackLng: true, trackAt: true, fcmToken: true },
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
  // إيقاظ الخدمة الأصلية فقط عند بدء التتبع (كان خاملاً) — لا مع كل نبضة (كل 30ث)
  const newlyStarted = r.techs.filter((t) => !isFresh(t.trackReqAt));
  await prisma.technician.updateMany({ where: { id: { in: r.techs.map((t) => t.id) } }, data: { trackReqAt: now } });
  await wakeTechs(newlyStarted, "track-start");

  // أقرب عامود اشتراكات لكل فني (يظهر نصاً بجانب اسمه على الخريطة — لا كمؤشّر):
  // نجلب أعمدة صندوقٍ يضمّ كل المواقع (+هامش ~2كم) ثم أقرب عامود ضمن 2كم لكل فني.
  const located = r.techs.filter((t) => t.trackLat != null && t.trackLng != null);
  const nearestPole = new Map<number, string>();
  if (located.length > 0) {
    const pad = 0.02; // ≈ 2كم
    const lats = located.map((t) => t.trackLat as number), lngs = located.map((t) => t.trackLng as number);
    const poles = await prisma.mapPoint.findMany({
      where: {
        lat: { gte: Math.min(...lats) - pad, lte: Math.max(...lats) + pad },
        lng: { gte: Math.min(...lngs) - pad, lte: Math.max(...lngs) + pad },
      },
      take: 20000, // الجدول كله ~15 ألف نقطة خفيفة — لا اقتطاع كي لا يفوت الأقرب
    });
    const dist2 = (aLat: number, aLng: number, bLat: number, bLng: number) => {
      const dLat = aLat - bLat, dLng = (aLng - bLng) * Math.cos((aLat * Math.PI) / 180);
      return dLat * dLat + dLng * dLng; // مقارنة نسبية تكفي لاختيار الأقرب
    };
    const maxD2 = (2 / 111) * (2 / 111); // لا معنى لعامودٍ أبعد من ~2كم
    for (const t of located) {
      let best: string | null = null, bestD = Infinity;
      for (const p of poles) {
        const d = dist2(t.trackLat as number, t.trackLng as number, p.lat, p.lng);
        if (d < bestD) { bestD = d; best = p.name; }
      }
      if (best && bestD <= maxD2) nearestPole.set(t.id, best);
    }
  }

  return NextResponse.json({
    ok: true,
    locations: r.techs.map((t) => ({
      id: t.id, name: t.name,
      lat: t.trackLat, lng: t.trackLng,
      at: t.trackAt, fresh: !!t.trackAt && now.getTime() - t.trackAt.getTime() < 3 * 60_000,
      pole: nearestPole.get(t.id) ?? null,
    })),
  });
}

// إيقاف التتبع: مسح النبضة فقط (يوقف طلب الإرسال من الهاتف) ويُبقي آخر موقع محفوظاً
async function stopTracking(ids: number[]) {
  const r = await ownedTechs(ids);
  if ("error" in r) return r.error;
  await prisma.technician.updateMany({
    where: { id: { in: r.techs.map((t) => t.id) } },
    data: { trackReqAt: null },
  });
  await wakeTechs(r.techs, "track-stop"); // إيقاف فوري للخدمة الأصلية (لا انتظار 90ث)
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
      // التتبع لم يعُد مطلوباً — أبلغ التطبيق بالتوقف (نُبقي آخر موقع محفوظاً)
      await prisma.technician.update({ where: { id: tech.technicianId }, data: { trackReqAt: null } });
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
