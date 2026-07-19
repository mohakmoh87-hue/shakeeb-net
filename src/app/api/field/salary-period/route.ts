import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { currentPeriodFromDays } from "@/lib/salary";
import { baghdadDayKey } from "@/lib/attendance";

export const dynamic = "force-dynamic";

// فترة احتساب الرواتب عامة لكل مكاتب الوكيل — يومان من الشهر (بداية/نهاية) تتكرّر شهرياً.
async function agentDays(agentId: number | null) {
  if (agentId == null) return { fromDay: null as number | null, toDay: null as number | null };
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { salaryFromDay: true, salaryToDay: true } });
  return { fromDay: a?.salaryFromDay ?? null, toDay: a?.salaryToDay ?? null };
}

// GET: يومَا الفترة + الفترة الحالية المحسوبة (from/to بالتاريخ الكامل للعرض)
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const days = await agentDays(g.session.agentId);
  const current = currentPeriodFromDays(days.fromDay, days.toDay, baghdadDayKey(new Date()));
  return NextResponse.json({ ...days, from: current?.from ?? null, to: current?.to ?? null });
}

// PUT: ضبط يومَي الفترة (1-31). البداية في شهر والنهاية في الشهر التالي — تتكرّر للأبد حتى تُغيَّر.
export async function PUT(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  if (g.session.agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بالحساب" }, { status: 400 });
  const parsed = z.object({
    fromDay: z.coerce.number().int().min(1).max(31),
    toDay: z.coerce.number().int().min(1).max(31),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخل يومَي البداية والنهاية (1 إلى 31)" }, { status: 400 });
  await prisma.agent.update({ where: { id: g.session.agentId }, data: { salaryFromDay: parsed.data.fromDay, salaryToDay: parsed.data.toDay } });
  const current = currentPeriodFromDays(parsed.data.fromDay, parsed.data.toDay, baghdadDayKey(new Date()));
  return NextResponse.json({ ok: true, fromDay: parsed.data.fromDay, toDay: parsed.data.toDay, from: current?.from ?? null, to: current?.to ?? null });
}
