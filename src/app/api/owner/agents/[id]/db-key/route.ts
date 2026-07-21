import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner, confirmOwnerPassword } from "@/lib/guard";
import { regenerateAgentRoleUrl } from "@/lib/agentDbRole";

export const dynamic = "force-dynamic";

// إعادة توليد مفتاح قاعدة بيانات الوكيل (RLS): يبدّل كلمة سر دوره عند الشك بتسريب.
// الحواسيب القديمة تفقد الاتصال حتى تُجدَّد تنصيباتها برمز جديد. للمالك فقط،
// وبتأكيد كلمة سر السوبر أدمن (عملية حساسة).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const body = await request.json().catch(() => null);
  if (!(await confirmOwnerPassword(g.session.userId, body?.ownerPassword))) {
    return NextResponse.json({ error: "كلمة سر السوبر أدمن مطلوبة وغير صحيحة — لا يمكن تغيير مفتاح القاعدة بدونها" }, { status: 403 });
  }
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
