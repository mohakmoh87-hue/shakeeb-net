import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getLastView } from "@/lib/sasViewCache";

// إرجاع المشتركين المعروضين حالياً في لوحة SAS4 المضمّنة
export async function GET() {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const session = g.session!;

  const view = getLastView(session.userId);
  if (!view || view.users.length === 0) {
    return NextResponse.json(
      { error: "لم تُعرض أي صفحة في لوحة SAS4 بعد. تصفّح صفحة المشتركين في اللوحة ثم أعد المحاولة." },
      { status: 400 },
    );
  }

  // تمييز المستوردين مسبقاً — ضمن مكاتب وكيل المستخدم فقط (تطابُق sasId مع وكيل آخر لا يعنينا)
  const { agentTowerIds } = await import("@/lib/guard");
  const towers = await agentTowerIds(session);
  const existing = await prisma.subscriber.findMany({
    where: { sasId: { in: view.users.map((u) => u.sasId) }, towerId: { in: towers.length ? towers : [-1] } },
    select: { sasId: true },
  });
  const existingIds = new Set(existing.map((e) => e.sasId));

  return NextResponse.json({
    towerId: view.towerId,
    users: view.users.map((u) => ({ ...u, alreadyImported: existingIds.has(u.sasId) })),
  });
}
