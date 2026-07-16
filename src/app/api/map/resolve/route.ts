import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveLocation, extractNetUser, gmapsUrl, wazeUrl } from "@/lib/mapLocation";

export const dynamic = "force-dynamic";

// موقع مشترك على الخريطة: بـ ?netUser= أو ?subscriberId= أو ?text= (لبطاقة يدوية)
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const url = new URL(request.url);
  let netUser = url.searchParams.get("netUser");
  const subscriberId = Number(url.searchParams.get("subscriberId"));
  const text = url.searchParams.get("text");

  if (!netUser && subscriberId) {
    const s = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { netUser: true } });
    netUser = s?.netUser ?? null;
  }
  if (!netUser && text) netUser = extractNetUser(text);
  if (!netUser) return NextResponse.json({ error: "لا يوجد يوزر لتحديد الموقع" }, { status: 404 });

  const loc = await resolveLocation(netUser);
  if (!loc) return NextResponse.json({ error: "موقع هذا اليوزر غير موجود في الخريطة", netUser }, { status: 404 });

  return NextResponse.json({
    netUser,
    name: loc.name,
    lat: loc.lat,
    lng: loc.lng,
    gmaps: gmapsUrl(loc.lat, loc.lng),
    waze: wazeUrl(loc.lat, loc.lng),
  });
}
