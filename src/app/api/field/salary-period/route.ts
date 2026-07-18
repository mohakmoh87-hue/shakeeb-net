import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// فترة احتساب الرواتب عامة لكل مكاتب الوكيل — يقرؤها/يضبطها المدير
async function agentPeriod(agentId: number | null) {
  if (agentId == null) return { from: null as string | null, to: null as string | null };
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { salaryPeriodFrom: true, salaryPeriodTo: true } });
  return { from: a?.salaryPeriodFrom ?? null, to: a?.salaryPeriodTo ?? null };
}

// GET: الفترة الحالية
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  return NextResponse.json(await agentPeriod(g.session.agentId));
}

// PUT: ضبط الفترة (from ≤ to، صيغة YYYY-MM-DD)
const dayRe = /^\d{4}-\d{2}-\d{2}$/;
export async function PUT(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  if (g.session.agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بالحساب" }, { status: 400 });
  const parsed = z.object({
    from: z.string().regex(dayRe, "تاريخ غير صحيح"),
    to: z.string().regex(dayRe, "تاريخ غير صحيح"),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  if (parsed.data.from > parsed.data.to) return NextResponse.json({ error: "تاريخ البداية بعد النهاية" }, { status: 400 });
  await prisma.agent.update({ where: { id: g.session.agentId }, data: { salaryPeriodFrom: parsed.data.from, salaryPeriodTo: parsed.data.to } });
  return NextResponse.json({ ok: true, from: parsed.data.from, to: parsed.data.to });
}
