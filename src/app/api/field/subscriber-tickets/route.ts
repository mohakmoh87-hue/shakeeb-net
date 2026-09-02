import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getEffectiveTicketDest, getPortalEnabled } from "@/lib/appConfig";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";

export const dynamic = "force-dynamic";

// تذاكرُ المشتركين الواصلةُ لهذا الوكيل (معزولةٌ بـagentId) — عمود «تذاكر المشتركين».
// تُحجَب إن كان توجيهُ المالك «supercell» فقط، أو إن كانت التذكرةُ بلا وكيلٍ مطابق.
// **الوجهةُ الفعليّة**: إطفاءُ بوّابة سوبر سيل يُحوّلها «للوكيل» حتماً (شرطُ محمد) فلا تُحبَس التذاكر.
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  const [dest, portal] = await Promise.all([getEffectiveTicketDest(), getPortalEnabled()]);
  if (agentId == null) return NextResponse.json({ tickets: [], dest });
  await ensureSubscriberTicketsTable();
  // 🔒 سوبر سيل مطفأةٌ ⇒ **لا وجودَ لقنواتها لدى الوكيل** (لا بطاقاتِ شركةٍ ولا وارد) — تبقى
  //    تذاكرُ المشتركين وحدَها (طلباتُ التطبيق، ليست من سوبر سيل). قاعدةُ محمد: «كأنّها لا وجودَ لها».
  // وحين سوبر سيل شغّالة: بطاقاتُ الشركة تصل الوكيلَ دائماً؛ تذاكرُ المشتركين تخضع لتوجيه «supercell».
  const where = !portal
    ? { agentId, source: { notIn: ["company", "agent-inbox"] } }
    : dest === "supercell"
      ? { agentId, source: "company" }
      : { agentId, source: { not: "agent-inbox" } };
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
  // العزل: لا تُحدَّث إلا تذكرةٌ تخصّ وكيلَ الجلسة، **وليست بطاقةَ وارده للشركة** (تلك تديرها الشركة)
  const t = await prisma.subscriberTicket.findFirst({ where: { id, agentId, source: { not: "agent-inbox" } }, select: { id: true } });
  if (!t) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.subscriberTicket.update({
    where: { id },
    data: { status, handledById: g.session.userId ?? null, handledAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
