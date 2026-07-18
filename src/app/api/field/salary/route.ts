import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { baghdadDayKey } from "@/lib/attendance";
import { computeSalary, type SalaryAttendance, type SalaryLeave, type SalaryAdjustment } from "@/lib/salary";

export const dynamic = "force-dynamic";

async function statementFor(technicianId: number, salary: number) {
  const todayKey = baghdadDayKey(new Date());
  const [att, leaves, adj] = await Promise.all([
    prisma.attendance.findMany({ where: { technicianId }, select: { dayKey: true, checkIn: true, lateDeduction: true, earlyDeduction: true, overtimeAddition: true } }),
    prisma.leave.findMany({ where: { technicianId }, select: { dayKey: true, kind: true, paid: true, status: true, reason: true } }),
    prisma.adjustment.findMany({ where: { technicianId }, select: { dayKey: true, kind: true, amount: true, status: true, reason: true } }),
  ]);
  return computeSalary(salary, att as SalaryAttendance[], leaves as SalaryLeave[], adj as SalaryAdjustment[], todayKey);
}

// GET: للفني → كشفه + أرشيفه (قراءة). للمدير → كشف فني ?technicianId، أو قائمة فنيّي المكتب.
export async function GET(request: Request) {
  const tech = await getTechSession();
  if (tech) {
    const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { salary: true, name: true } });
    const result = await statementFor(tech.technicianId, t?.salary ?? 0);
    const history = await prisma.salaryStatement.findMany({ where: { technicianId: tech.technicianId }, orderBy: { id: "desc" }, take: 12 });
    return NextResponse.json({ role: "technician", name: t?.name, salary: t?.salary ?? 0, statement: result, history });
  }

  const g = await guard("field.manage");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const technicianId = Number(url.searchParams.get("technicianId")) || null;
  const reqOffice = Number(url.searchParams.get("officeId")) || null;
  const agentTowers = await agentTowerIds(g.session);

  if (technicianId) {
    const t = await prisma.technician.findUnique({ where: { id: technicianId } });
    if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
    const result = await statementFor(technicianId, t.salary ?? 0);
    const history = await prisma.salaryStatement.findMany({ where: { technicianId }, orderBy: { id: "desc" }, take: 12 });
    return NextResponse.json({ role: "manager", name: t.name, salary: t.salary ?? 0, statement: result, history });
  }

  // قائمة فنيّي المكتب مع صافي كل واحد
  const towerFilter = reqOffice ? [reqOffice] : (agentTowers.length ? agentTowers : [-1]);
  const techs = await prisma.technician.findMany({ where: { towerId: { in: towerFilter }, isDeleted: false }, select: { id: true, name: true, salary: true } });
  const list = await Promise.all(techs.map(async (t) => {
    const r = await statementFor(t.id, t.salary ?? 0);
    return { id: t.id, name: t.name, salary: t.salary ?? 0, net: r.net, daysPaid: r.daysPaid };
  }));
  return NextResponse.json({ role: "manager", technicians: list });
}

// POST (المدير فقط): تسديد راتب الفني — صرف يُنقص المبلغ الكلي + أرشفة + تصفير السجل الخام.
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z.object({ technicianId: z.coerce.number() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });

  const t = await prisma.technician.findUnique({ where: { id: parsed.data.technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  const result = await statementFor(t.id, t.salary ?? 0);
  const paid = Math.max(0, result.net);

  const statement = await prisma.$transaction(async (tx) => {
    // قيد الصرف (يُنقص المبلغ الكلي الموجود) — فقط إن كان هناك صافي موجب
    let moneyTxId: number | null = null;
    if (paid > 0) {
      const mt = await tx.moneyTx.create({
        data: {
          moneyIn: 0, moneyOut: paid, date: new Date(), serverDate: new Date(),
          userId: g.session.userId, towerId: t.towerId, sourceType: "salary",
          notes: `راتب الفني ${t.name} (${result.periodFrom} → ${result.periodTo}) — أيام ${result.daysPaid}`,
        },
      });
      moneyTxId = mt.id;
    }
    // أرشفة الكشف
    const st = await tx.salaryStatement.create({
      data: {
        technicianId: t.id, technicianName: t.name, agentId: t.agentId, towerId: t.towerId,
        periodFrom: result.periodFrom, periodTo: result.periodTo, daysPaid: result.daysPaid, dailyAmount: result.dailyAmount,
        baseEarned: result.baseEarned, overtime: result.overtime, bonuses: result.bonuses,
        attendanceDeductions: result.attendanceDeductions, confirmedDeductions: result.confirmedDeductions, net: result.net,
        details: JSON.stringify(result.items), paidByUser: g.session.fullName ?? g.session.username, moneyTxId,
      },
    });
    // تصفير السجل الخام: الحضور، الخصومات المؤكّدة، الإجازات المقرّرة (تبقى المعلّقة للفترة القادمة)
    await tx.attendance.deleteMany({ where: { technicianId: t.id } });
    await tx.adjustment.deleteMany({ where: { technicianId: t.id, status: "confirmed" } });
    await tx.leave.deleteMany({ where: { technicianId: t.id, status: { in: ["approved", "rejected"] } } });
    return st;
  });

  return NextResponse.json({ ok: true, paid, statement });
}
