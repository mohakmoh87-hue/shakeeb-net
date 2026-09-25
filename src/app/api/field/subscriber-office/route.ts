import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ===== اقتراحُ مكتب البطاقة من رقم هاتف المشترك (طلبُ محمد 2026-09-25) =====
// عرضٌ فقط: يُطابق الرقمَ داخل مكاتب وكيل الجلسة ويُعيد مكتبَ المشترك ليُقترح في نافذة
// رفع البطاقة — فيُرفَع التنصيبُ على مكتبه لا على مكتب الرافع. لا يُعيد هاتفاً ولا عنواناً.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const digits = (new URL(request.url).searchParams.get("phone") ?? "").replace(/\D/g, "");
  if (digits.length < 9) return NextResponse.json({ match: null });

  const towerIds = await agentTowerIds(session);
  if (!towerIds.length) return NextResponse.json({ match: null });

  const tail = digits.slice(-9);
  const sub = await prisma.subscriber.findFirst({
    where: { isDeleted: false, towerId: { in: towerIds }, phone: { contains: tail } },
    select: { id: true, name: true, towerId: true },
    orderBy: { id: "desc" },
  });
  if (!sub || sub.towerId == null) return NextResponse.json({ match: null });

  const office = await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { name: true } });
  return NextResponse.json({ match: { subscriberId: sub.id, name: sub.name, officeId: sub.towerId, officeName: office?.name ?? null } });
}
