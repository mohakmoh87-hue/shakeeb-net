import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentOfficeFilter } from "@/lib/guard";

export const dynamic = "force-dynamic";

// المكاتب التي تنتظر موافقة المستخدم لإرسال تذكير الانتهاء اليوم
// (الإرسال الصامت مُطفأ silent="0"، وواتساب المكتب مُفعّل، ولم يُعالَج اليوم، وفيها منتهون خلال يومين)
export async function GET() {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;

  const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const offices = await prisma.tower.findMany({
    where: {
      isDeleted: false,
      silent: "0",
      NOT: { waEnabled: "0" },
      OR: [{ lastReminderDate: null }, { lastReminderDate: { not: today } }],
      ...(await agentOfficeFilter(g.session)),
    },
    select: { id: true, name: true },
  });
  if (offices.length === 0) return NextResponse.json({ pending: [] });

  const now = new Date();
  const limit = new Date();
  limit.setDate(limit.getDate() + 2);

  const pending: { officeId: number; officeName: string | null; count: number }[] = [];
  for (const o of offices) {
    const count = await prisma.subscriber.count({
      where: { isDeleted: false, waEnabled: true, towerId: o.id, dateTo: { not: null, gte: now, lte: limit } },
    });
    if (count > 0) pending.push({ officeId: o.id, officeName: o.name, count });
  }
  return NextResponse.json({ pending });
}
