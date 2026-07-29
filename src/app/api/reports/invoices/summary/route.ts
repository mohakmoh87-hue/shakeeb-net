import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, towerScope, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ملخّص منحنى فاتورة المبيع لبطاقة الشاشة الرئيسية (٨-ب):
// مجاميع يومية للشهر الحالي مقابل نفس المدة من الشهر السابق + عدد ومبلغ اليوم.
// فواتير الماستر (type="ماستر") مستبعدة — مالها بحساب الماستر المستقل.
export async function GET(request: Request) {
  const g = await guard("reports.view");
  if (g.error) return g.error;
  let scope: { towerId?: number | { in: number[] } } = await towerScope(g.session);
  // المدير يختار مكتباً محدّداً من قائمة البطاقة (officeId) — يُتحقّق أنه من مكاتب وكيله
  if (g.session.isAdmin) {
    const officeId = Number(new URL(request.url).searchParams.get("officeId"));
    if ((await agentTowerIds(g.session)).includes(officeId)) scope = { towerId: officeId };
  }

  // بداية الشهر الحالي والسابق بتوقيت العراق (UTC+3)
  const now = new Date();
  const iq = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = iq.getUTCFullYear(), m = iq.getUTCMonth(), today = iq.getUTCDate();
  const thisStart = new Date(Date.UTC(y, m, 1) - 3 * 60 * 60 * 1000);
  const lastStart = new Date(Date.UTC(y, m - 1, 1) - 3 * 60 * 60 * 1000);
  // نهاية «نفس المدة» من الشهر السابق: نفس يوم الشهر الحالي
  const lastEnd = new Date(Date.UTC(y, m - 1, today, 23, 59, 59) - 3 * 60 * 60 * 1000);

  const rows = await prisma.invoice.findMany({
    where: {
      isDeleted: false, NOT: { type: "ماستر" }, ...scope,
      date: { gte: lastStart, lte: now },
    },
    select: { date: true, waselHim: true },
  });

  // تجميع يومي (يوم الشهر 1..31) لكل شهر
  const thisDays = new Array<number>(today).fill(0);
  const lastDays = new Array<number>(today).fill(0);
  let thisTotal = 0, lastTotal = 0, thisCount = 0, todayCount = 0, todayIn = 0;
  for (const r of rows) {
    if (!r.date) continue;
    const d = new Date(r.date.getTime() + 3 * 60 * 60 * 1000);
    const day = d.getUTCDate();
    const v = r.waselHim ?? 0;
    if (r.date >= thisStart) {
      if (day <= today) {
        thisDays[day - 1] += v; thisTotal += v; thisCount++;
        if (day === today) { todayCount++; todayIn += v; }
      }
    } else if (r.date <= lastEnd && day <= today) {
      lastDays[day - 1] += v; lastTotal += v;
    }
  }

  return NextResponse.json({ days: today, thisDays, lastDays, thisTotal, lastTotal, thisCount, todayCount, todayIn });
}
