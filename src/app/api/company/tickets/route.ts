import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanySession } from "@/lib/companyAuth";
import { getEffectiveTicketDest } from "@/lib/appConfig";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";

export const dynamic = "force-dynamic";

// تذاكرُ المشتركين للشركة (سوبر سيل) — تراها كلَّها (الشركةُ فوق كلّ الوكلاء)، مع اسم الوكيل/المكتب.
// تُحجَب إن كان توجيهُ المالك «agent» فقط. + قائمةُ كلّ الوكلاء لمُنتقي «أسنِد لوكيل».
export async function GET() {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const dest = await getEffectiveTicketDest();
  await ensureSubscriberTicketsTable();
  // في وضع «الوكيل فقط» تبقى للشركة التذاكرُ **بلا وكيلٍ مطابق** (تعذّر توجيهُها) فلا تضيع؛
  // في «سوبر سيل»/«كلاهما» ترى الشركةُ كلَّ التذاكر.
  const tickets = await prisma.subscriberTicket.findMany({
    where: dest === "agent" ? { agentId: null } : {},
    orderBy: { id: "desc" },
  });
  const agentIds = [...new Set(tickets.map((t) => t.agentId).filter((x): x is number => x != null))];
  const towerIds = [...new Set(tickets.map((t) => t.towerId).filter((x): x is number => x != null))];
  const [agents, towers] = await Promise.all([
    agentIds.length ? prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    towerIds.length ? prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const agentName: Record<string, string> = {};
  for (const a of agents) agentName[String(a.id)] = a.name;
  const towerName: Record<string, string> = {};
  for (const t of towers) towerName[String(t.id)] = t.name ?? "";
  // كلُّ الوكلاء لمُنتقي «أسنِد لوكيل» (اسمٌ فقط — الشركةُ فوق الوكلاء وترى أسماءهم في التذاكر أصلاً)
  const allAgents = await prisma.agent.findMany({ where: { isDeleted: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return NextResponse.json({ tickets, dest, agentName, towerName, allAgents });
}

const ALLOWED = new Set(["new", "contacted", "done", "rejected"]);
export async function PATCH(request: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id) || 0;
  if (!id) return NextResponse.json({ error: "طلبٌ غير صالح" }, { status: 400 });
  await ensureSubscriberTicketsTable();

  // ═════ أسنِد لوكيل: ضبطُ agentId ⇒ تظهرُ في إدارة فنّيّي ذلك الوكيل (الجانبُ الآخرُ يُرشّح بـagentId) ═════
  // الشركةُ «فوق الوكلاء» فتُسنِدُ لأيّ وكيل. القيمةُ تُتحقَّق (وكيلٌ حقيقيّ) أو null (إعادةٌ لـ«بلا وكيل»).
  if ("agentId" in (body ?? {})) {
    const agentId = body.agentId == null ? null : Number(body.agentId) || 0;
    if (agentId != null) {
      if (!agentId) return NextResponse.json({ error: "وكيلٌ غير صالح" }, { status: 400 });
      const a = await prisma.agent.findFirst({ where: { id: agentId, isDeleted: false }, select: { id: true } });
      if (!a) return NextResponse.json({ error: "وكيلٌ غير موجود" }, { status: 404 });
    }
    const t = await prisma.subscriberTicket.findFirst({ where: { id }, select: { id: true } });
    if (!t) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
    await prisma.subscriberTicket.update({ where: { id }, data: { agentId, handledAt: new Date() } });
    return NextResponse.json({ ok: true, agentId });
  }

  // تغييرُ الحالة (كما كان)
  const status = typeof body?.status === "string" ? body.status : "";
  if (!ALLOWED.has(status)) return NextResponse.json({ error: "طلبٌ غير صالح" }, { status: 400 });
  const t = await prisma.subscriberTicket.findFirst({ where: { id }, select: { id: true } });
  if (!t) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.subscriberTicket.update({ where: { id }, data: { status, handledAt: new Date() } });
  return NextResponse.json({ ok: true });
}
