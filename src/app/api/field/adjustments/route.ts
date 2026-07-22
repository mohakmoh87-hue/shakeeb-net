import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { baghdadDayKey, parseHHMM, baghdadMinutesOfDay } from "@/lib/attendance";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

// POST (المدير فقط): خصم/مكافأة يدوية على فني — تُعتمد فوراً (confirmed) وتظهر في تفاصيل الراتب.
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z.object({
    technicianId: z.coerce.number(),
    kind: z.enum(["deduction", "bonus"]).default("deduction"),
    amount: z.coerce.number().int().positive("المبلغ يجب أن يكون أكبر من صفر"),
    reason: z.string().trim().min(1, "السبب مطلوب"),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });

  const t = await prisma.technician.findUnique({ where: { id: parsed.data.technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  const adj = await prisma.adjustment.create({
    data: {
      technicianId: t.id, agentId: t.agentId, towerId: t.towerId,
      kind: parsed.data.kind, source: "manual", amount: parsed.data.amount, reason: parsed.data.reason,
      status: "confirmed", dayKey: baghdadDayKey(new Date()),
      decidedBy: g.session.fullName ?? g.session.username, decidedAt: new Date(),
    },
  });
  await notify({ agentId: t.agentId, towerId: t.towerId, type: "deduction", title: parsed.data.kind === "bonus" ? "مكافأة يدوية" : "خصم يدوي", body: `${t.name}: ${parsed.data.kind === "bonus" ? "مكافأة" : "خصم"} ${parsed.data.amount.toLocaleString("en-US")} — ${parsed.data.reason}`, refType: "adjustment", refId: adj.id });
  return NextResponse.json({ ok: true, adjustment: adj });
}

// GET: للفني → خصوماته/مكافآته. للمدير → المعلّق أولاً لفنيّي مكتبه + pendingCount.
export async function GET(request: Request) {
  const tech = await getTechSession();
  if (tech) {
    const rows = await prisma.adjustment.findMany({ where: { technicianId: tech.technicianId }, orderBy: { id: "desc" }, take: 60 });
    const sum = (kind: string, status: string) => rows.filter((r) => r.kind === kind && r.status === status).reduce((a, r) => a + r.amount, 0);
    return NextResponse.json({
      role: "technician", adjustments: rows,
      pendingDeductions: sum("deduction", "pending"), confirmedDeductions: sum("deduction", "confirmed"),
      confirmedBonuses: sum("bonus", "confirmed"),
    });
  }

  const g = await guard("field.manage");
  if (g.error) return g.error;
  const reqOffice = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const agentTowers = await agentTowerIds(g.session);
  const towerFilter = reqOffice ? [reqOffice] : (agentTowers.length ? agentTowers : [-1]);
  const techs = await prisma.technician.findMany({ where: { towerId: { in: towerFilter }, isDeleted: false }, select: { id: true, name: true, shiftStart: true, entryGraceMin: true, lateRatePerMin: true } });
  const nameById = new Map(techs.map((t) => [t.id, t.name]));
  const techById = new Map(techs.map((t) => [t.id, t]));
  const rows = await prisma.adjustment.findMany({ where: { technicianId: { in: techs.map((t) => t.id) } }, orderBy: { id: "desc" }, take: 120 });
  const order = (s: string) => (s === "pending" ? 0 : 1);
  rows.sort((a, b) => order(a.status) - order(b.status) || b.id - a.id);

  // طلبات «نسيت البصمة» المعلّقة (على سجل الحضور) — لعرضها ضمن نفس نافذة المراجعة
  const excuseRecs = await prisma.attendance.findMany({
    where: { technicianId: { in: techs.map((t) => t.id) }, lateExcuse: "pending" },
    select: { id: true, technicianId: true, dayKey: true, checkIn: true },
    orderBy: { id: "desc" }, take: 60,
  });
  const lateExcuses = excuseRecs.map((r) => {
    const tt = techById.get(r.technicianId);
    const startMin = parseHHMM(tt?.shiftStart);
    const grace = Math.max(0, tt?.entryGraceMin ?? 0);
    // تجاوُز السماحية يُلغيها — الدقائق تُحسب من بدء الدوام نفسه (نفس قاعدة computeAttendance)
    const ciMin = r.checkIn && startMin != null ? baghdadMinutesOfDay(r.checkIn) : null;
    const lateMin = ciMin != null && startMin != null && ciMin > startMin + grace ? ciMin - startMin : 0;
    return {
      technicianId: r.technicianId, technicianName: nameById.get(r.technicianId) ?? `#${r.technicianId}`,
      dayKey: r.dayKey, checkIn: r.checkIn, lateMinutes: lateMin, estDeduction: lateMin * Math.max(0, tt?.lateRatePerMin ?? 0),
    };
  });

  const pendingCount = rows.filter((r) => r.status === "pending").length + lateExcuses.length;
  return NextResponse.json({
    role: "manager", pendingCount, lateExcuses,
    adjustments: rows.map((r) => ({ ...r, technicianName: nameById.get(r.technicianId) ?? `#${r.technicianId}` })),
  });
}

// PATCH (المدير فقط): تأكيد/رفض خصم معلّق — عزل عبر ownsTower
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z.object({ id: z.coerce.number(), status: z.enum(["confirmed", "rejected"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const adj = await prisma.adjustment.findUnique({ where: { id: parsed.data.id } });
  if (!adj || !(await ownsTower(g.session, adj.towerId))) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (adj.status !== "pending") return NextResponse.json({ error: "مُقرّر مسبقاً" }, { status: 400 });

  const updated = await prisma.adjustment.update({
    where: { id: adj.id },
    data: { status: parsed.data.status, decidedBy: g.session.fullName ?? g.session.username, decidedAt: new Date() },
  });
  return NextResponse.json({ ok: true, adjustment: updated });
}

// DELETE (المدير فقط): حذف أي خصم/مكافأة (بأي حالة) — عزل عبر ownsTower
export async function DELETE(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const adj = await prisma.adjustment.findUnique({ where: { id } });
  if (!adj || !(await ownsTower(g.session, adj.towerId))) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.adjustment.delete({ where: { id } });
  return NextResponse.json({ ok: true, deleted: id });
}
