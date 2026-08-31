import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";

export const dynamic = "force-dynamic";

const TYPES = new Set(["صيانة", "توصيل"]);

// طلبُ صيانةٍ/توصيلٍ من مشتركٍ **مسجَّل** ⇒ تذكرةٌ تُوجَّه لوكيلِ مكتبه من البيانات مباشرةً
// (subscriberId → subscriber.towerId → Tower.agentId) — أدقُّ من GPS، بلا لبس.
export async function POST(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  if (!rateLimit(`app-request:${sess.subscriberId}`, 6, 60_000)) {
    return NextResponse.json({ error: "طلباتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!TYPES.has(type)) return NextResponse.json({ error: "نوعُ طلبٍ غير صالح" }, { status: 400 });

  const sub = await prisma.subscriber.findUnique({
    where: { id: sess.subscriberId },
    select: { id: true, name: true, phone: true, towerId: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });

  const tower = sub.towerId
    ? await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { agentId: true } })
    : null;

  await ensureSubscriberTicketsTable();
  await prisma.subscriberTicket.create({
    data: {
      name: sub.name ?? "مشترك",
      phone: sub.phone ?? "",
      note: note || null,
      subscriberId: sub.id,
      towerId: sub.towerId,
      agentId: tower?.agentId ?? null,
      type,
      status: "new",
      source: "app-request",
    },
  });
  return NextResponse.json({ ok: true, routed: (tower?.agentId ?? null) != null });
}
