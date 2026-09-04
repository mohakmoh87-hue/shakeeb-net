import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// بيانات الجلسة الحالية (للواجهة: إظهار الأزرار حسب الصلاحيات)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  // معلومات الوكيل (سقف المكاتب + العدد الحالي) لعرضها في صفحة المكاتب
  let officeCap: number | null = null, officeCount = 0, agentName: string | null = null, subDealerCheck = false;
  if (session.agentId != null) {
    const [agent, count] = await Promise.all([
      prisma.agent.findUnique({ where: { id: session.agentId }, select: { officeCap: true, name: true, subDealerCheck: true } }),
      prisma.tower.count({ where: { agentId: session.agentId, isDeleted: false } }),
    ]);
    officeCap = agent?.officeCap ?? null;
    agentName = agent?.name ?? null;
    subDealerCheck = agent?.subDealerCheck ?? false;
    officeCount = count;
  }
  return NextResponse.json({
    userId: session.userId,
    username: session.username,
    fullName: session.fullName,
    isAdmin: session.isAdmin,
    isOwner: session.isOwner,
    permissions: session.permissions ?? [],
    // الواجهةُ تحتاجه أيضاً: زرٌّ يظهر ثمّ يفشل أسوأُ من زرٍّ غائب
    deniedPermissions: session.deniedPermissions ?? [],
    towerId: session.towerId,
    agentId: session.agentId,
    agentName,
    officeCap,
    officeCount,
    subDealerCheck,
  });
}
