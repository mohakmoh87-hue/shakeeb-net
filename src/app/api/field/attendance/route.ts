import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { baghdadDayKey, computeAttendance, parseHHMM, distanceMeters } from "@/lib/attendance";
import { notify } from "@/lib/notify";
import { endSupport } from "@/lib/field";

export const dynamic = "force-dynamic";

// تحقّق البصمة الجغرافية (منع صارم): يرجع رسالة خطأ إن مُنعت البصمة، أو null إن سُمح.
async function geofenceError(towerId: number | null, lat: number | undefined, lng: number | undefined): Promise<string | null> {
  if (towerId == null) return null;
  const office = await prisma.tower.findUnique({ where: { id: towerId }, select: { geoEnabled: true, lat: true, lng: true, geoRadius: true, name: true } });
  if (!office || !office.geoEnabled || office.lat == null || office.lng == null) return null; // غير مفعّل/بلا موقع ⇒ لا تحقّق
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    return "تعذّر تحديد موقعك — فعّل الموقع (GPS) واسمح للتطبيق بالوصول إليه ثم أعد المحاولة";
  }
  const dist = distanceMeters(office.lat, office.lng, lat, lng);
  const radius = office.geoRadius ?? 200;
  if (dist > radius) return `يجب أن تكون داخل «${office.name ?? "المكتب"}» للبصمة — تبعد عنه ~${dist} م (المسموح ${radius} م)`;
  return null;
}

// سجل حضور فني ليوم اليوم (أو ينشئه)
async function todayRecord(technicianId: number) {
  const key = baghdadDayKey(new Date());
  return prisma.attendance.findFirst({ where: { technicianId, dayKey: key }, orderBy: { id: "desc" } });
}
function stateOf(rec: { checkIn: Date | null; checkOut: Date | null } | null): "none" | "in" | "done" {
  if (!rec || !rec.checkIn) return "none";
  return rec.checkOut ? "done" : "in";
}

// GET: للفني → حالة يومه. للمدير/الموظف → حضور فنيّي المكتب اليوم.
export async function GET(request: Request) {
  const tech = await getTechSession();
  if (tech) {
    const rec = await todayRecord(tech.technicianId);
    return NextResponse.json({ role: "technician", state: stateOf(rec), checkIn: rec?.checkIn ?? null, checkOut: rec?.checkOut ?? null });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const reqOffice = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const key = baghdadDayKey(new Date());
  const agentTowers = await agentTowerIds(session);
  // عزل الوكيل: لا يُعرض حضور مكتبٍ لا يتبع وكيل المستخدم
  if (reqOffice && !agentTowers.includes(reqOffice)) {
    return NextResponse.json({ error: "لا يمكنك عرض حضور مكتب آخر" }, { status: 403 });
  }
  const where = reqOffice
    ? { towerId: reqOffice, isDeleted: false }
    : { towerId: { in: agentTowers.length ? agentTowers : [-1] }, isDeleted: false };
  const techs = await prisma.technician.findMany({ where, select: { id: true, name: true, shiftStart: true, shiftEnd: true, towerId: true }, orderBy: { id: "asc" } });
  const recs = await prisma.attendance.findMany({ where: { technicianId: { in: techs.map((t) => t.id) }, dayKey: key } });
  const byTech = new Map(recs.map((r) => [r.technicianId, r]));
  return NextResponse.json({
    role: "manager",
    technicians: techs.map((t) => {
      const r = byTech.get(t.id) ?? null;
      return { id: t.id, name: t.name, shiftStart: t.shiftStart, shiftEnd: t.shiftEnd, state: stateOf(r), checkIn: r?.checkIn ?? null, checkOut: r?.checkOut ?? null };
    }),
  });
}

// POST (فني فقط): بصمة دخول/خروج بوقت الخادم (بغداد)
export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });
  const parsed = z.object({ action: z.enum(["in", "out"]), lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "إجراء غير صحيح" }, { status: 400 });

  // بيانات الفني (بما فيها الدعم) — البصمة تتحوّل لمكتب الدعم إن كان الفني مُعاراً
  const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { towerId: true, supportTowerId: true, shiftStart: true, shiftEnd: true, entryGraceMin: true, exitGraceMin: true, lateRatePerMin: true, overtimeRatePerMin: true } });
  const stampOffice = t?.supportTowerId ?? tech.towerId; // مكتب البصمة الحالي (الدعم أو الأصلي)
  const onSupport = t?.supportTowerId != null;

  // البصمة الجغرافية (منع صارم): يجب أن يكون الفني داخل نطاق مكتب البصمة الحالي
  const geoErr = await geofenceError(stampOffice, parsed.data.lat, parsed.data.lng);
  if (geoErr) return NextResponse.json({ error: geoErr }, { status: 403 });

  const now = new Date();
  const key = baghdadDayKey(now);
  const rec = await todayRecord(tech.technicianId);

  if (parsed.data.action === "in") {
    if (rec?.checkIn) return NextResponse.json({ error: "سجّلت دخولك اليوم مسبقاً" }, { status: 400 });
    const created = await prisma.attendance.create({
      data: { technicianId: tech.technicianId, agentId: tech.agentId, towerId: stampOffice, dayKey: key, checkIn: now, checkoutBy: null },
    });
    await notify({ agentId: tech.agentId, towerId: stampOffice, type: "checkin", title: "بصمة دخول", body: `${tech.name} سجّل الدخول${onSupport ? " (دعم)" : ""}`, refType: "technician", refId: tech.technicianId });
    return NextResponse.json({ ok: true, state: "in", checkIn: created.checkIn });
  }

  // خروج
  if (!rec?.checkIn) return NextResponse.json({ error: "سجّل دخولك أولاً" }, { status: 400 });
  if (rec.checkOut) return NextResponse.json({ error: "سجّلت خروجك اليوم مسبقاً" }, { status: 400 });
  const calc = t ? computeAttendance(t, rec.checkIn, now) : null;
  const updated = await prisma.attendance.update({
    where: { id: rec.id },
    data: { checkOut: now, checkoutBy: "tech", ...(calc ?? {}) },
  });
  const late = calc?.lateDeduction ?? 0, early = calc?.earlyDeduction ?? 0, ot = calc?.overtimeAddition ?? 0;
  const extra = late || early ? ` (خصم ${(late + early).toLocaleString("en-US")})` : ot ? ` (إضافي ${ot.toLocaleString("en-US")})` : "";
  await notify({ agentId: tech.agentId, towerId: stampOffice, type: "checkout", title: "بصمة خروج", body: `${tech.name} سجّل الخروج${extra}`, refType: "technician", refId: tech.technicianId });

  // إن كان على دعم: الخروج ينهي الدعم ويعيده لمكتبه الأصلي (في كل الأحوال بنهاية الدوام)
  if (onSupport) {
    await endSupport(tech.technicianId);
    await notify({ agentId: tech.agentId, towerId: tech.towerId, type: "checkout", title: "انتهاء الدعم", body: `${tech.name} أنهى الدعم وعاد لمكتبه`, refType: "technician", refId: tech.technicianId });
  }
  return NextResponse.json({ ok: true, state: "done", checkOut: updated.checkOut, calc, supportEnded: onSupport });
}

// وقت (UTC) لدقيقةٍ من يوم بغداد المحدّد (YYYY-MM-DD)
function bgTimeUtc(dayKey: string, minutesOfDay: number): Date {
  const [y, mo, d] = dayKey.split("-").map(Number);
  const bgMidnightUtc = Date.UTC(y, mo - 1, d, 0, 0, 0) - 3 * 3600 * 1000;
  return new Date(bgMidnightUtc + minutesOfDay * 60 * 1000);
}

// PATCH (المدير فقط): بصمة خروج يدوية (now/scheduled)، أو إضافة بصمة يوم كامل لتاريخٍ يختاره (addDay).
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z.object({
    technicianId: z.coerce.number(),
    mode: z.enum(["now", "scheduled"]).optional(),
    addDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const t = await prisma.technician.findUnique({ where: { id: parsed.data.technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  // إضافة بصمة يوم كامل (دخول=بدء الدوام، خروج=نهايته) — بلا خصم/إضافي
  if (parsed.data.addDay) {
    const startMin = parseHHMM(t.shiftStart), endMin0 = parseHHMM(t.shiftEnd);
    if (startMin == null || endMin0 == null) return NextResponse.json({ error: "حدّد دوام الفني (بداية/نهاية) أولاً" }, { status: 400 });
    const checkIn = bgTimeUtc(parsed.data.addDay, startMin);
    const checkOut = bgTimeUtc(parsed.data.addDay, endMin0 <= startMin ? endMin0 + 1440 : endMin0);
    const calc = computeAttendance(t, checkIn, checkOut); // أوقات الدوام بالضبط ⇒ صفر خصم/إضافي
    const existing = await prisma.attendance.findFirst({ where: { technicianId: t.id, dayKey: parsed.data.addDay } });
    if (existing) await prisma.attendance.update({ where: { id: existing.id }, data: { checkIn, checkOut, checkoutBy: "manager", ...calc } });
    else await prisma.attendance.create({ data: { technicianId: t.id, agentId: t.agentId, towerId: t.towerId, dayKey: parsed.data.addDay, checkIn, checkOut, checkoutBy: "manager", ...calc } });
    return NextResponse.json({ ok: true, addedDay: parsed.data.addDay });
  }

  // خلاف ذلك: بصمة خروج يدوية لليوم
  const rec = await todayRecord(t.id);
  if (!rec?.checkIn) return NextResponse.json({ error: "لا توجد بصمة دخول لليوم" }, { status: 400 });
  if (rec.checkOut) return NextResponse.json({ error: "سُجّل الخروج مسبقاً" }, { status: 400 });

  let checkoutAt = new Date();
  if (parsed.data.mode === "scheduled") {
    // نهاية الدوام المحدّدة لهذا اليوم (بغداد) — تُحسب بلا خصم/إضافة
    const endMin = parseHHMM(t.shiftEnd);
    if (endMin != null) {
      const b = new Date(rec.checkIn.getTime() + 3 * 3600 * 1000); // يوم بغداد للبصمة
      const y = b.getUTCFullYear(), mo = b.getUTCMonth(), d = b.getUTCDate();
      // منتصف ليل بغداد لذلك اليوم بالـUTC = 00:00 بغداد = 21:00 UTC اليوم السابق
      const bgMidnightUtc = Date.UTC(y, mo, d, 0, 0, 0) - 3 * 3600 * 1000;
      checkoutAt = new Date(bgMidnightUtc + endMin * 60 * 1000);
    }
  }
  const calc = computeAttendance(t, rec.checkIn, checkoutAt);
  await prisma.attendance.update({ where: { id: rec.id }, data: { checkOut: checkoutAt, checkoutBy: "manager", ...calc } });
  return NextResponse.json({ ok: true, checkOut: checkoutAt, calc });
}

// DELETE (المدير فقط): مسح بصمة يومٍ للفني إن كانت خاطئة (اليوم افتراضياً) — يستطيع الفني إعادة البصمة.
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const technicianId = Number(url.searchParams.get("technicianId"));
  const dayKey = url.searchParams.get("dayKey") || baghdadDayKey(new Date());
  if (!technicianId) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });
  const t = await prisma.technician.findUnique({ where: { id: technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  const res = await prisma.attendance.deleteMany({ where: { technicianId, dayKey } });
  return NextResponse.json({ ok: true, deleted: res.count });
}
