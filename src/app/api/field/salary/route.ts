import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { statementForTechnician as statementFor } from "@/lib/salary";

export const dynamic = "force-dynamic";

// يومَا احتساب الراتب للوكيل (من/إلى) — تُشتق منهما فترة كل فنيٍّ (مجمّدة) داخل الحساب
async function salaryDaysOfAgent(agentId: number | null): Promise<{ fromDay: number | null; toDay: number | null }> {
  if (agentId == null) return { fromDay: null, toDay: null };
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { salaryFromDay: true, salaryToDay: true } });
  return { fromDay: a?.salaryFromDay ?? null, toDay: a?.salaryToDay ?? null };
}

// GET: للفني → كشفه + أرشيفه (قراءة). للمدير → كشف فني ?technicianId، أو قائمة فنيّي المكتب.
export async function GET(request: Request) {
  const tech = await getTechSession();
  if (tech) {
    const t = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { salary: true, name: true } });
    const days = await salaryDaysOfAgent(tech.agentId);
    const result = await statementFor(tech.technicianId, t?.salary ?? 0, days.fromDay, days.toDay);
    const history = await prisma.salaryStatement.findMany({ where: { technicianId: tech.technicianId }, orderBy: { id: "desc" }, take: 12 });
    const period = days.fromDay ? { from: result.periodFrom, to: result.periodTo } : null;
    return NextResponse.json({ role: "technician", name: t?.name, salary: t?.salary ?? 0, statement: result, history, period });
  }

  const g = await guard("field.manage");
  if (g.error) return g.error;
  const url = new URL(request.url);
  const technicianId = Number(url.searchParams.get("technicianId")) || null;
  const reqOffice = Number(url.searchParams.get("officeId")) || null;
  const agentTowers = await agentTowerIds(g.session);
  const days = await salaryDaysOfAgent(g.session.agentId);

  if (technicianId) {
    const t = await prisma.technician.findUnique({ where: { id: technicianId } });
    if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
    const result = await statementFor(technicianId, t.salary ?? 0, days.fromDay, days.toDay);
    const history = await prisma.salaryStatement.findMany({ where: { technicianId }, orderBy: { id: "desc" }, take: 12 });
    const period = days.fromDay ? { from: result.periodFrom, to: result.periodTo } : null;
    return NextResponse.json({ role: "manager", name: t.name, salary: t.salary ?? 0, statement: result, history, period });
  }

  // قائمة فنيّي المكتب مع صافي كل واحد — لا يُقبل officeId إلا إن كان أحد مكاتب وكيل المستخدم (عزل)
  const towerFilter = reqOffice && agentTowers.includes(reqOffice) ? [reqOffice] : (agentTowers.length ? agentTowers : [-1]);
  const techs = await prisma.technician.findMany({ where: { towerId: { in: towerFilter }, isDeleted: false }, select: { id: true, name: true, salary: true } });
  const list = await Promise.all(techs.map(async (t) => {
    const r = await statementFor(t.id, t.salary ?? 0, days.fromDay, days.toDay);
    return { id: t.id, name: t.name, salary: t.salary ?? 0, net: r.net, daysPaid: r.daysPaid };
  }));
  return NextResponse.json({ role: "manager", technicians: list, period: days.fromDay ? { from: null, to: null } : null });
}

// POST (المدير فقط): تسديد راتب الفني ضمن فترته المجمّدة — صرف الصافي + أرشفة + تصفير سجل الفترة فقط.
// source: "daily" = صرفٌ في التقرير اليومي (يُنقص المبلغ الكلي مرّة). "total" = خصمٌ من المبلغ الكلي دون ظهور بالتقرير اليومي.
export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const parsed = z
    .object({ technicianId: z.coerce.number(), source: z.enum(["daily", "total"]).default("daily") })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });
  const source = parsed.data.source;

  const t = await prisma.technician.findUnique({ where: { id: parsed.data.technicianId } });
  if (!t || t.isDeleted || !(await ownsTower(g.session, t.towerId))) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });

  const days = await salaryDaysOfAgent(t.agentId ?? g.session.agentId);
  const result = await statementFor(t.id, t.salary ?? 0, days.fromDay, days.toDay);
  const paid = Math.max(0, result.net);
  // حدود الفترة المجمّدة الفعليّة (كما حُسبت للفني) — الحذف والتعليم ضمنها فقط؛ ما بعدها يُرحَّل
  const from = result.periodFrom, to = result.periodTo;
  const dateRange = { gte: new Date(`${from}T00:00:00+03:00`), lte: new Date(`${to}T23:59:59.999+03:00`) };
  const dayRange = { gte: from, lte: to };

  const statement = await prisma.$transaction(async (tx) => {
    // قيد الصرف — يُنقص المبلغ الكلي الموجود (فقط إن كان الصافي موجباً)
    let moneyTxId: number | null = null;
    if (paid > 0) {
      if (source === "daily") {
        // مصروفٌ في التقرير اليومي لذلك اليوم (يُنقص المبلغ الكلي مرّة واحدة عبر التقرير)
        const mt = await tx.moneyTx.create({
          data: {
            moneyIn: 0, moneyOut: paid, date: new Date(), serverDate: new Date(),
            userId: g.session.userId, towerId: t.towerId, sourceType: "salary",
            notes: `راتب الفني ${t.name} (${from} → ${to}) — أيام ${result.daysPaid}`,
          },
        });
        moneyTxId = mt.id;
      } else {
        // خصمٌ من المبلغ الكلي دون أثرٍ على التقرير اليومي (حركة إدارة نوعها salary)
        await tx.managerTx.create({
          data: {
            type: "salary", amount: paid, userId: g.session.userId,
            agentId: t.agentId ?? g.session.agentId ?? -1, // عزل المستأجر
            notes: `راتب الفني ${t.name} (${from} → ${to}) — أيام ${result.daysPaid}`,
          },
        });
      }
    }
    // أرشفة الكشف
    const st = await tx.salaryStatement.create({
      data: {
        technicianId: t.id, technicianName: t.name, agentId: t.agentId, towerId: t.towerId,
        periodFrom: from, periodTo: to, daysPaid: result.daysPaid, dailyAmount: result.dailyAmount,
        baseEarned: result.baseEarned, overtime: result.overtime, bonuses: result.bonuses,
        attendanceDeductions: result.attendanceDeductions, confirmedDeductions: result.confirmedDeductions, net: result.net,
        details: JSON.stringify(result.items), paidByUser: g.session.fullName ?? g.session.username, moneyTxId,
      },
    });
    // تعليم حركات حساب الموظف (المصروفات والمقبوضات) المحتسَبة — تبقى في التقرير اليومي ولا تُعاد
    if (t.accountId) {
      await tx.moneyTx.updateMany({
        where: { accountId: t.accountId, isDeleted: false, salaryStatementId: null, date: dateRange },
        data: { salaryStatementId: st.id },
      });
    }
    // تصفير سجل الفترة فقط: الحضور والخصومات المؤكّدة والإجازات المقرّرة ضمن [from,to]؛ ما بعدها يُرحَّل
    await tx.attendance.deleteMany({ where: { technicianId: t.id, dayKey: dayRange } });
    await tx.adjustment.deleteMany({ where: { technicianId: t.id, status: "confirmed", dayKey: dayRange } });
    await tx.leave.deleteMany({ where: { technicianId: t.id, status: { in: ["approved", "rejected"] }, dayKey: dayRange } });
    return st;
  });

  return NextResponse.json({ ok: true, paid, source, statement });
}
