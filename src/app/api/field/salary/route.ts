import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { statementForTechnician as statementFor, currentPeriodFromDays, type SalaryPeriod } from "@/lib/salary";
import { baghdadDayKey } from "@/lib/attendance";

export const dynamic = "force-dynamic";

// الفترة الحالية للوكيل — تُحسب من يومَي البداية/النهاية (متكرّرة شهرياً)، أو null إن لم تُضبط
async function periodOfAgent(agentId: number | null): Promise<SalaryPeriod | null> {
  if (agentId == null) return null;
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { salaryFromDay: true, salaryToDay: true } });
  return currentPeriodFromDays(a?.salaryFromDay, a?.salaryToDay, baghdadDayKey(new Date()));
}

// GET: للفني → كشفه + أرشيفه (قراءة). للمدير → كشف فني ?technicianId، أو قائمة فنيّي المكتب.
export async function GET(request: Request) {
  const tech = await getTechSession();
  if (tech) {
    const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { salary: true, name: true } });
    const period = await periodOfAgent(tech.agentId);
    const result = await statementFor(tech.technicianId, t?.salary ?? 0, period);
    const history = await prisma.salaryStatement.findMany({ where: { technicianId: tech.technicianId }, orderBy: { id: "desc" }, take: 12 });
    return NextResponse.json({ role: "technician", name: t?.name, salary: t?.salary ?? 0, statement: result, history, period });
  }

  const g = await guard("field.manage");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const technicianId = Number(url.searchParams.get("technicianId")) || null;
  const reqOffice = Number(url.searchParams.get("officeId")) || null;
  const agentTowers = await agentTowerIds(g.session);
  const period = await periodOfAgent(g.session.agentId);

  if (technicianId) {
    const t = await prisma.technician.findUnique({ where: { id: technicianId } });
    if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
    const result = await statementFor(technicianId, t.salary ?? 0, period);
    const history = await prisma.salaryStatement.findMany({ where: { technicianId }, orderBy: { id: "desc" }, take: 12 });
    return NextResponse.json({ role: "manager", name: t.name, salary: t.salary ?? 0, statement: result, history, period });
  }

  // قائمة فنيّي المكتب مع صافي كل واحد
  const towerFilter = reqOffice ? [reqOffice] : (agentTowers.length ? agentTowers : [-1]);
  const techs = await prisma.technician.findMany({ where: { towerId: { in: towerFilter }, isDeleted: false }, select: { id: true, name: true, salary: true } });
  const list = await Promise.all(techs.map(async (t) => {
    const r = await statementFor(t.id, t.salary ?? 0, period);
    return { id: t.id, name: t.name, salary: t.salary ?? 0, net: r.net, daysPaid: r.daysPaid };
  }));
  return NextResponse.json({ role: "manager", technicians: list, period });
}

// POST (المدير فقط): تسديد راتب الفني ضمن الفترة — صرف الصافي + أرشفة + تصفير سجل الفترة فقط.
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z.object({ technicianId: z.coerce.number() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });

  const t = await prisma.technician.findUnique({ where: { id: parsed.data.technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  const period = await periodOfAgent(t.agentId ?? g.session.agentId);
  const result = await statementFor(t.id, t.salary ?? 0, period);
  const paid = Math.max(0, result.net);
  // حدود تاريخ حركات حساب الموظف ضمن الفترة (بغداد)
  const dateRange = period ? { gte: new Date(`${period.from}T00:00:00+03:00`), lte: new Date(`${period.to}T23:59:59.999+03:00`) } : undefined;
  // نطاق مفاتيح الأيام للحذف (الفترة فقط؛ ما بعدها يُرحَّل للشهر القادم)
  const dayRange = period ? { gte: period.from, lte: period.to } : undefined;

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
    // تعليم حركات حساب الموظف (المصروفات والمقبوضات) المحتسَبة — تبقى في التقرير اليومي ولا تُعاد
    if (t.accountId) {
      await tx.moneyTx.updateMany({
        where: { accountId: t.accountId, isDeleted: false, salaryStatementId: null, ...(dateRange ? { date: dateRange } : {}) },
        data: { salaryStatementId: st.id },
      });
    }
    // تصفير سجل الفترة فقط: الحضور والخصومات المؤكّدة والإجازات المقرّرة ضمن [from,to]؛ ما بعدها يُرحَّل
    await tx.attendance.deleteMany({ where: { technicianId: t.id, ...(dayRange ? { dayKey: dayRange } : {}) } });
    await tx.adjustment.deleteMany({ where: { technicianId: t.id, status: "confirmed", ...(dayRange ? { dayKey: dayRange } : {}) } });
    await tx.leave.deleteMany({ where: { technicianId: t.id, status: { in: ["approved", "rejected"] }, ...(dayRange ? { dayKey: dayRange } : {}) } });
    return st;
  });

  return NextResponse.json({ ok: true, paid, statement });
}
