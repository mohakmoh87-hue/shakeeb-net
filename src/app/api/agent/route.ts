import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// اسم/علامة الوكيل الحالي (يظهر بكامل البرنامج)
export async function GET() {
  const g = await guard("agent.settings");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ name: null });
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, officeCap: true, planExpiry: true, isTrial: true, backupEmail: true } });
  return NextResponse.json(agent ?? { name: null });
}

// ⚠️ اسم الوكيل (العلامة) **لا يُعدَّل من هنا** (قرار محمد 2026-08-09): يعدّله **مالك النظام
// حصراً** من صفحة المالك (PATCH /api/owner/agents/[id] بحارس guardOwner) — فوكيلٌ كتب اسمه
// خطأً لا يُصلحه بنفسه، ولا يبدّل علامته بلا علم المالك. هنا يبقى إيميل النسخ الاحتياطي فقط.
const schema = z.object({
  backupEmail: z.string().email("إيميل غير صالح").nullable().optional(),
});

// تعديل إيميل النسخ الاحتياطي للوكيل (المدير يعدّل وكيله فقط)
export async function PATCH(request: Request) {
  const g = await guard("agent.settings");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  // محاولة تعديل الاسم تُرفَض صراحةً (بدل تجاهلها بصمت) — كي يعرف المدير أنّها للمالك
  if (body && typeof body.name === "string") {
    return NextResponse.json({ error: "اسم العلامة يعدّله مالك النظام فقط — راجعه لتصحيحه" }, { status: 403 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (parsed.data.backupEmail !== undefined) data.backupEmail = parsed.data.backupEmail?.trim() || null;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "لا تغييرات" }, { status: 400 });
  await prisma.agent.update({ where: { id: agentId }, data });
  return NextResponse.json({ ok: true });
}
