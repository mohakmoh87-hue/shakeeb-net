import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanySession } from "@/lib/companyAuth";
import { getTicketDest } from "@/lib/appConfig";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";

export const dynamic = "force-dynamic";

// تذاكرُ المشتركين للشركة (سوبر سيل) — تراها كلَّها (الشركةُ فوق كلّ الوكلاء)، مع اسم الوكيل/المكتب.
// تُحجَب إن كان توجيهُ المالك «agent» فقط.
export async function GET() {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const dest = await getTicketDest();
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
  return NextResponse.json({ tickets, dest, agentName, towerName });
}

const ALLOWED = new Set(["new", "contacted", "done", "rejected"]);
export async function PATCH(request: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id) || 0;
  const status = typeof body?.status === "string" ? body.status : "";
  if (!id || !ALLOWED.has(status)) return NextResponse.json({ error: "طلبٌ غير صالح" }, { status: 400 });
  await ensureSubscriberTicketsTable();
  const t = await prisma.subscriberTicket.findFirst({ where: { id }, select: { id: true } });
  if (!t) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.subscriberTicket.update({ where: { id }, data: { status, handledAt: new Date() } });
  return NextResponse.json({ ok: true });
}
