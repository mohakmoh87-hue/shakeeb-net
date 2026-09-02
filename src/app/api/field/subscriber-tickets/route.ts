import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getEffectiveTicketDest } from "@/lib/appConfig";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";

export const dynamic = "force-dynamic";

// تذاكرُ المشتركين الواصلةُ لهذا الوكيل (معزولةٌ بـagentId) — عمود «تذاكر المشتركين».
// تُحجَب إن كان توجيهُ المالك «supercell» فقط، أو إن كانت التذكرةُ بلا وكيلٍ مطابق.
// **الوجهةُ الفعليّة**: إطفاءُ بوّابة سوبر سيل يُحوّلها «للوكيل» حتماً (شرطُ محمد) فلا تُحبَس التذاكر.
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  const dest = await getEffectiveTicketDest();
  if (agentId == null) return NextResponse.json({ tickets: [], dest });
  await ensureSubscriberTicketsTable();
  // بطاقاتُ الشركة (source=company) مُرسَلةٌ للوكيل مباشرةً فتصله **دائماً**؛ تذاكرُ المشتركين
  // وحدَها تخضع لتوجيه المالك «supercell» (فتُحجَب عن الوكيل حينها).
  const where = dest === "supercell" ? { agentId, source: "company" } : { agentId };
  const tickets = await prisma.subscriberTicket.findMany({ where, orderBy: { id: "desc" } });
  return NextResponse.json({ tickets, dest });
}

const ALLOWED = new Set(["new", "contacted", "done", "rejected"]);
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "ليس لديك وكيل" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id) || 0;
  const status = typeof body?.status === "string" ? body.status : "";
  if (!id || !ALLOWED.has(status)) return NextResponse.json({ error: "طلبٌ غير صالح" }, { status: 400 });
  await ensureSubscriberTicketsTable();
  // العزل: لا تُحدَّث إلا تذكرةٌ تخصّ وكيلَ الجلسة
  const t = await prisma.subscriberTicket.findFirst({ where: { id, agentId }, select: { id: true } });
  if (!t) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.subscriberTicket.update({
    where: { id },
    data: { status, handledById: g.session.userId ?? null, handledAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
