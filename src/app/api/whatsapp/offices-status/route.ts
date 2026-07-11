import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { whatsappStatus } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// حالة واتساب للتنبيه: كل مستخدم يُنبَّه على مكتبه فقط، والأدمن على كل المكاتب
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  // الأدمن: كل المكاتب | مستخدم بمكتب: مكتبه فقط | مستخدم بلا مكتب: لا شيء
  let officeFilter: Record<string, unknown> = {};
  if (!session.isAdmin) {
    if (session.towerId == null) return NextResponse.json({ offices: [], disconnected: [] });
    officeFilter = { id: session.towerId };
  }

  // المكاتب التي تحتاج واتساب (لمشتركيها أو لمديرها) — مستقل عن مفتاح رسائل المشتركين
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false, OR: [{ NOT: { waEnabled: "0" } }, { managerPhone: { not: null } }], ...officeFilter },
    select: { id: true, name: true },
  });
  const list = offices.map((o) => ({ id: o.id, name: o.name, state: whatsappStatus(o.id).state }));
  return NextResponse.json({ offices: list, disconnected: list.filter((o) => o.state !== "ready") });
}
