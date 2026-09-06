import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { phoneCore } from "@/lib/subscriberLogin";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";
import { resolveCoverageOwner } from "@/lib/coverageOwners";
import { getPortalEnabled } from "@/lib/appConfig";

export const dynamic = "force-dynamic";

// 🗺️ طلبُ تنصيب/صيانة/توصيل من شاشة «أماكن التغطية» (طلبُ محمد 2026-09-06) ⇒ تذكرةٌ للشركة
// تُوجَّه للوكيل المالك للعمود (بمشتركيه) إن وُجد، وإلّا تبقى للشركة لتُسنِدها للوكيل المعنيّ.
// لا تُتاح والبوّابةُ مطفأة (لا سوبر سيل يستقبل) — التطبيقُ يعرض رقمَ الشركة للاتّصال حينها.
const TYPES = ["تنصيب", "صيانة", "توصيل"];

export async function POST(request: Request) {
  if (!rateLimit(`coverage-request:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  if (!(await getPortalEnabled())) return NextResponse.json({ error: "الخدمةُ غيرُ متاحة حاليّاً" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" && TYPES.includes(body.type) ? body.type : null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  const lat = typeof body?.lat === "number" && isFinite(body.lat) ? body.lat : null;
  const lng = typeof body?.lng === "number" && isFinite(body.lng) ? body.lng : null;

  if (!type) return NextResponse.json({ error: "نوعُ الطلب غير صالح" }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "أدخِل الاسمَ الكامل" }, { status: 400 });
  const core = phoneCore(typeof body?.phone === "string" ? body.phone : "");
  if (!core) return NextResponse.json({ error: "رقمُ هاتفٍ غير صالح" }, { status: 400 });
  if (!rateLimit(`coverage-request-phone:${core}`, 3, 30 * 60_000)) {
    return NextResponse.json({ error: "سُجّل طلبٌ بهذا الرقم مؤخّراً — سنتواصل معك قريباً" }, { status: 429 });
  }

  const own = lat != null && lng != null ? await resolveCoverageOwner(lat, lng) : null;

  await ensureSubscriberTicketsTable();
  await prisma.subscriberTicket.create({
    data: {
      name,
      phone: "0" + core,
      area: own?.area ?? null,
      note: note || null,
      lat,
      lng,
      nearestPole: null,
      poleDistanceM: null,
      towerId: own?.towerId ?? null,
      agentId: own?.agentId ?? null,
      type,
      status: "new",
      source: "app",
    },
  });
  return NextResponse.json({ ok: true, routed: own?.agentId != null });
}
