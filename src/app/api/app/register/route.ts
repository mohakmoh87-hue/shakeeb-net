import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { phoneCore } from "@/lib/subscriberLogin";
import { resolveTicketLocation, ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";

export const dynamic = "force-dynamic";

// تسجيلُ مشتركٍ جديد من تطبيق كابينة ⇒ تذكرةُ اشتراكٍ تُوجَّه بالموقع (أقرب عامود ← وكيل).
export async function POST(request: Request) {
  if (!rateLimit(`app-register:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const area = typeof body?.area === "string" ? body.area.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const lat = typeof body?.lat === "number" && isFinite(body.lat) ? body.lat : null;
  const lng = typeof body?.lng === "number" && isFinite(body.lng) ? body.lng : null;

  if (name.length < 2) return NextResponse.json({ error: "أدخِل الاسمَ الكامل" }, { status: 400 });
  const core = phoneCore(typeof body?.phone === "string" ? body.phone : "");
  if (!core) return NextResponse.json({ error: "رقمُ هاتفٍ غير صالح" }, { status: 400 });
  if (!rateLimit(`app-register-phone:${core}`, 3, 30 * 60_000)) {
    return NextResponse.json({ error: "سُجّل طلبٌ بهذا الرقم مؤخّراً — سنتواصل معك قريباً" }, { status: 429 });
  }

  await ensureSubscriberTicketsTable();
  const loc = await resolveTicketLocation(lat, lng);
  await prisma.subscriberTicket.create({
    data: {
      name,
      phone: "0" + core,
      area: area || null,
      note: note || null,
      lat,
      lng,
      nearestPole: loc.nearestPole,
      poleDistanceM: loc.poleDistanceM,
      towerId: loc.towerId,
      agentId: loc.agentId,
      type: "اشتراك جديد",
      status: "new",
      source: "app",
    },
  });
  return NextResponse.json({ ok: true, routed: loc.agentId != null });
}
