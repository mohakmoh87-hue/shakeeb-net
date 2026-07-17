import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// بيانات الجلسة الحالية (للواجهة: إظهار الأزرار حسب الصلاحيات)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  // معلومات الوكيل (سقف المكاتب + العدد الحالي) لعرضها في صفحة المكاتب
  let officeCap: number | null = null, officeCount = 0, agentName: string | null = null;
  if (session.agentId != null) {
    const [agent, count] = await Promise.all([
      prisma.agent.findUnique({ where: { id: session.agentId }, select: { officeCap: true, name: true } }),
      prisma.tower.count({ where: { agentId: session.agentId, isDeleted: false } }),
    ]);
    officeCap = agent?.officeCap ?? null;
    agentName = agent?.name ?? null;
    officeCount = count;
  }
  return NextResponse.json({
    userId: session.userId,
    username: session.username,
    fullName: session.fullName,
    isAdmin: session.isAdmin,
    isOwner: session.isOwner,
    permissions: session.permissions ?? [],
    towerId: session.towerId,
    agentId: session.agentId,
    agentName,
    officeCap,
    officeCount,
  });
}
