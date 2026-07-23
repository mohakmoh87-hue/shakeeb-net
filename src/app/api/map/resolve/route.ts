import { NextResponse } from "next/server";
import { getSession, getTechSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveLocation, extractNetUser, areaFromTowerName, gmapsUrl, wazeUrl } from "@/lib/mapLocation";

export const dynamic = "force-dynamic";

// موقع مشترك على الخريطة: بـ ?netUser= أو ?subscriberId= أو ?text= (لبطاقة يدوية).
// المنطقة تُشتق من مكتب المشترك (أو ?towerId=) — أدقّ من لاحقة اليوزر.
// يقبل جلسة المستخدم أو جلسة الفني (لزر الخريطة في بطاقاته). عزل الفني بوكيله.
export async function GET(request: Request) {
  const session = await getSession();
  const tech = session ? null : await getTechSession();
  if (!session && !tech) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const url = new URL(request.url);
  let netUser = url.searchParams.get("netUser");
  const subscriberId = Number(url.searchParams.get("subscriberId"));
  const text = url.searchParams.get("text");
  let towerId = Number(url.searchParams.get("towerId")) || null;

  // مسار subscriberId للمستخدمين فقط (الفني يستعمل نصّ البطاقة/اليوزر — عزل بيانات وكيله)
  // عزل المستأجر: المشترك يجب أن يتبع مكتباً يملكه المستخدم (كان يُقرأ بالمعرّف لأي وكيل)
  if (!netUser && subscriberId && !tech) {
    const s = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { netUser: true, towerId: true } });
    const { ownsTower } = await import("@/lib/guard");
    if (s && (await ownsTower(session, s.towerId))) {
      netUser = s.netUser ?? null;
      if (s.towerId && !towerId) towerId = s.towerId;
    }
  }
  if (!netUser && text) netUser = extractNetUser(text);
  if (!netUser) return NextResponse.json({ error: "لا يوجد يوزر لتحديد الموقع" }, { status: 404 });

  // منطقة الخريطة من مكتب المشترك: الإعداد اليدوي (mapArea) هو الأساس،
  // وإلا نستنتجها من اسم المكتب (توافقاً مع المكاتب القديمة قبل ضبط الإعداد)
  // الفني: المكتب مقصور على وكيله (وإلا نتجاهل التلميح).
  let areaHint: string | null = null;
  if (towerId) {
    // تلميح المنطقة مقصور على مكاتب وكيل الفاعل (فنياً كان أو مستخدماً)
    const agentId = tech ? tech.agentId : session?.agentId ?? -1;
    const t = await prisma.tower.findFirst({
      where: { id: towerId, agentId: agentId ?? -1 },
      select: { name: true, mapArea: true },
    });
    areaHint = (t?.mapArea && t.mapArea.trim()) ? t.mapArea.trim() : areaFromTowerName(t?.name);
  }

  const loc = await resolveLocation(netUser, areaHint);
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
