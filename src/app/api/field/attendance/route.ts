import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { baghdadDayKey, computeAttendance, parseHHMM } from "@/lib/attendance";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

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
  const parsed = z.object({ action: z.enum(["in", "out"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "إجراء غير صحيح" }, { status: 400 });

  const now = new Date();
  const key = baghdadDayKey(now);
  const rec = await todayRecord(tech.technicianId);

  if (parsed.data.action === "in") {
    if (rec?.checkIn) return NextResponse.json({ error: "سجّلت دخولك اليوم مسبقاً" }, { status: 400 });
    const created = await prisma.attendance.create({
      data: { technicianId: tech.technicianId, agentId: tech.agentId, towerId: tech.towerId, dayKey: key, checkIn: now, checkoutBy: null },
    });
    await notify({ agentId: tech.agentId, towerId: tech.towerId, type: "checkin", title: "بصمة دخول", body: `${tech.name} سجّل الدخول`, refType: "technician", refId: tech.technicianId });
    return NextResponse.json({ ok: true, state: "in", checkIn: created.checkIn });
  }

  // خروج
  if (!rec?.checkIn) return NextResponse.json({ error: "سجّل دخولك أولاً" }, { status: 400 });
  if (rec.checkOut) return NextResponse.json({ error: "سجّلت خروجك اليوم مسبقاً" }, { status: 400 });
  const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { shiftStart: true, shiftEnd: true, entryGraceMin: true, exitGraceMin: true, lateRatePerMin: true, overtimeRatePerMin: true } });
  const calc = t ? computeAttendance(t, rec.checkIn, now) : null;
  const updated = await prisma.attendance.update({
    where: { id: rec.id },
    data: { checkOut: now, checkoutBy: "tech", ...(calc ?? {}) },
  });
  const late = calc?.lateDeduction ?? 0, early = calc?.earlyDeduction ?? 0, ot = calc?.overtimeAddition ?? 0;
  const extra = late || early ? ` (خصم ${(late + early).toLocaleString("en-US")})` : ot ? ` (إضافي ${ot.toLocaleString("en-US")})` : "";
  await notify({ agentId: tech.agentId, towerId: tech.towerId, type: "checkout", title: "بصمة خروج", body: `${tech.name} سجّل الخروج${extra}`, refType: "technician", refId: tech.technicianId });
  return NextResponse.json({ ok: true, state: "done", checkOut: updated.checkOut, calc });
}

// PATCH (المدير فقط): بصمة خروج يدوية عند نسيان الفني — بالوقت الحالي أو بوقته المحدّد.
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z.object({ technicianId: z.coerce.number(), mode: z.enum(["now", "scheduled"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const t = await prisma.technician.findUnique({ where: { id: parsed.data.technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
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
