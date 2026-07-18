import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET: إشعارات وكيل المدير (الأحدث أولاً) + عدد غير المقروء. معزول بالوكيل.
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { agentId }, orderBy: { id: "desc" }, take: 50 }),
    prisma.notification.count({ where: { agentId, read: false } }),
  ]);
  return NextResponse.json({ notifications: items, unread });
}

// PATCH: وضع علامة «مقروء» (كلّها أو بمعرّفات محدّدة) ضمن وكيل المدير.
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  const parsed = z.object({ ids: z.array(z.coerce.number()).optional() }).safeParse(await request.json().catch(() => ({})));
  const ids = parsed.success ? parsed.data.ids : undefined;
  await prisma.notification.updateMany({
    where: { agentId, read: false, ...(ids && ids.length ? { id: { in: ids } } : {}) },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}
