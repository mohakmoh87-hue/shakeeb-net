import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanySession } from "@/lib/companyAuth";
import { getEffectiveTicketDest, getCompanyCardSlaHours, getCompanyCardCategories } from "@/lib/appConfig";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";

export const dynamic = "force-dynamic";

// ═════ رفعُ بطاقةِ شركةٍ لوكيل (طلبُ محمد 2026-09-02) — source=company ═════
// تظهرُ في عمود «تذاكر الشركة» لدى الوكيل (منفصلٍ عن تذاكر المشتركين) وفي متابعة الشركة.
// المهلةُ بسيطةٌ: ساعاتٌ ⇒ dueAt = الآن + ساعات (أو الافتراضُ من الإعدادات). لا موقعَ ولا توجيهَ
// تلقائيّ — الشركةُ تختار الوكيلَ صراحةً (هي فوق كلّ الوكلاء).
export async function POST(request: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  await ensureSubscriberTicketsTable();
  const body = await request.json().catch(() => null);
  const agentId = Number(body?.agentId) || 0;
  const category = typeof body?.category === "string" ? body.category.trim().slice(0, 80) : "";
  const customerName = typeof body?.customerName === "string" ? body.customerName.trim().slice(0, 120) : "";
  const customerPhone = typeof body?.customerPhone === "string" ? body.customerPhone.trim().slice(0, 30) : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!agentId || !category) return NextResponse.json({ error: "الوكيل والفئة مطلوبان" }, { status: 400 });
  const a = await prisma.agent.findFirst({ where: { id: agentId, isDeleted: false }, select: { id: true } });
  if (!a) return NextResponse.json({ error: "وكيلٌ غير موجود" }, { status: 404 });
  // الفئةُ من القائمة المعرَّفة حصراً (القائمةُ مرجعٌ لا نصٌّ حرّ) — تُدار من إعدادات بطاقات الشركة
  const cats = await getCompanyCardCategories();
  if (!cats.includes(category)) return NextResponse.json({ error: "فئةٌ غير معرَّفة" }, { status: 400 });
  const rawHours = Number(body?.slaHours);
  const slaHours = Number.isFinite(rawHours) && rawHours >= 1 && rawHours <= 720 ? Math.round(rawHours) : await getCompanyCardSlaHours();
  const dueAt = new Date(Date.now() + slaHours * 3600_000);
  const t = await prisma.subscriberTicket.create({
    data: {
      name: customerName || category, phone: customerPhone || "—", note: note || null,
      agentId, type: category, source: "company", status: "new", dueAt, raisedById: s.companyUserId,
    },
  });
  return NextResponse.json({ ok: true, id: t.id, dueAt: dueAt.toISOString() });
}

// تذاكرُ المشتركين للشركة (سوبر سيل) — تراها كلَّها (الشركةُ فوق كلّ الوكلاء)، مع اسم الوكيل/المكتب.
// تُحجَب إن كان توجيهُ المالك «agent» فقط. + قائمةُ كلّ الوكلاء لمُنتقي «أسنِد لوكيل».
export async function GET() {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const dest = await getEffectiveTicketDest();
  await ensureSubscriberTicketsTable();
  // في وضع «الوكيل فقط» تبقى للشركة التذاكرُ **بلا وكيلٍ مطابق** (تعذّر توجيهُها) فلا تضيع؛
  // في «سوبر سيل»/«كلاهما» ترى الشركةُ كلَّ التذاكر.
  // توجيهُ «الوكيل فقط» يخصّ تذاكرَ المشتركين (تبقى للشركةُ غيرُ الموجَّهة فلا تضيع)؛ أمّا بطاقاتُ
  // الشركة ووارد الوكلاء فهما قناتا الشركة نفسِها ⇒ تُرى دائماً مهما كان التوجيه.
  const tickets = await prisma.subscriberTicket.findMany({
    where: dest === "agent" ? { OR: [{ agentId: null }, { source: { in: ["company", "agent-inbox"] } }] } : {},
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

  // ═════ ردُّ الشركة على بطاقة وكيلٍ (وارد الوكلاء source=agent-inbox) ═════
  if (typeof body?.reply === "string") {
    const reply = body.reply.trim().slice(0, 1000);
    if (!reply) return NextResponse.json({ error: "الردُّ فارغ" }, { status: 400 });
    const t = await prisma.subscriberTicket.findFirst({ where: { id }, select: { id: true, status: true, source: true } });
    if (!t) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
    if (t.source !== "agent-inbox") return NextResponse.json({ error: "الردُّ لبطاقات الوكلاء فقط" }, { status: 400 });
    await prisma.subscriberTicket.update({
      where: { id },
      data: { reply, repliedAt: new Date(), handledAt: new Date(), ...(t.status === "new" ? { status: "contacted" } : {}) },
    });
    return NextResponse.json({ ok: true });
  }

  // تغييرُ الحالة (كما كان)
  const status = typeof body?.status === "string" ? body.status : "";
  if (!ALLOWED.has(status)) return NextResponse.json({ error: "طلبٌ غير صالح" }, { status: 400 });
  const t = await prisma.subscriberTicket.findFirst({ where: { id }, select: { id: true } });
  if (!t) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.subscriberTicket.update({ where: { id }, data: { status, handledAt: new Date() } });
  return NextResponse.json({ ok: true });
}
