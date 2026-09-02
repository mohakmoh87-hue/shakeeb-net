import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getAgentInboxCategories } from "@/lib/appConfig";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";

export const dynamic = "force-dynamic";

// «وارد الوكلاء» — جانبُ الوكيل: يرفع بطاقةً للشركة (source=agent-inbox) ويرى ردَّها وحالتَها.
// محروسٌ بـfield.manage (المديرُ/صاحبُ صلاحية إدارة الفنيين) ومعزولٌ بـagentId (يرى مراسلاتِه فقط).
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  const categories = await getAgentInboxCategories();
  if (agentId == null) return NextResponse.json({ cards: [], categories });
  await ensureSubscriberTicketsTable();
  const cards = await prisma.subscriberTicket.findMany({
    where: { agentId, source: "agent-inbox" }, orderBy: { id: "desc" },
    select: { id: true, type: true, note: true, status: true, reply: true, repliedAt: true, createdAt: true },
  });
  return NextResponse.json({ cards, categories });
}

export async function POST(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "ليس لديك وكيل" }, { status: 403 });
  await ensureSubscriberTicketsTable();
  const body = await request.json().catch(() => null);
  const category = typeof body?.category === "string" ? body.category.trim().slice(0, 80) : "";
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 500) : "";
  if (!category || !subject) return NextResponse.json({ error: "الفئة والموضوع مطلوبان" }, { status: 400 });
  const cats = await getAgentInboxCategories();
  if (!cats.includes(category)) return NextResponse.json({ error: "فئةٌ غير معرَّفة" }, { status: 400 });
  const t = await prisma.subscriberTicket.create({
    data: {
      name: "—", phone: "—", agentId, type: category, note: subject,
      source: "agent-inbox", status: "new", raisedById: g.session.userId ?? null,
    },
  });
  return NextResponse.json({ ok: true, id: t.id });
}
