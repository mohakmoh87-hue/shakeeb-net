import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// اسم/علامة الوكيل الحالي (يظهر بكامل البرنامج)
export async function GET() {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ name: null });
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, officeCap: true, planExpiry: true, isTrial: true } });
  return NextResponse.json(agent ?? { name: null });
}

const schema = z.object({ name: z.string().min(1, "الاسم مطلوب") });

// تعديل علامة الوكيل (المدير يعدّل اسم وكيله فقط)
export async function PATCH(request: Request) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  await prisma.agent.update({ where: { id: agentId }, data: { name: parsed.data.name.trim() } });
  return NextResponse.json({ ok: true });
}
