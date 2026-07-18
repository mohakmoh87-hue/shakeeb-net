import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { regenerateAgentRoleUrl } from "@/lib/agentDbRole";

export const dynamic = "force-dynamic";

// إعادة توليد مفتاح قاعدة بيانات الوكيل (RLS): يبدّل كلمة سر دوره عند الشك بتسريب.
// الحواسيب القديمة تفقد الاتصال حتى تُجدَّد تنصيباتها برمز جديد. للمالك فقط.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isFinite(agentId)) return NextResponse.json({ error: "معرّف غير صالح" }, { status: 400 });

  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, isDeleted: true } });
  if (!agent || agent.isDeleted) return NextResponse.json({ error: "الوكيل غير موجود" }, { status: 404 });

  try {
    await regenerateAgentRoleUrl(agentId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[owner/agents/db-key] تعذّر إعادة توليد المفتاح:", e);
    return NextResponse.json({ error: "تعذّر إعادة توليد المفتاح" }, { status: 500 });
  }
}
