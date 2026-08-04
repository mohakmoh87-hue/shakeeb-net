import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { iraqTodayRange } from "@/lib/dailyReport";

export const dynamic = "force-dynamic";

// خلاصة صندوق المصروفات والمقبوضات لبطاقة الشاشة الرئيسية — اليدوي فقط
// (نفس فلتر صفحة /cashbox: ما سُجّل في الحساب ووصولاته)، لا التفعيلات ولا
// الفواتير، ولِيَوم العراق الحالي فقط — تتصفّر بعد منتصف الليل كبقية أرقام
// الرئيسية (طلب محمد 2026-07-29). المدير يمرّر officeId لمكتب محدّد أو
// يتركه للكل؛ مستخدم المكتب محصور بمكتبه دائماً.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  // فحص صلاحية مالية — كانت هذه الخلاصة تُقرأ بمجرّد تسجيل الدخول، فأي فني
  // يقرأ مجاميع قبض وصرف مكتبه (خلل صلاحيات كشفه تدقيق 2026-08-04).
  if (!can(session, "finance.view") && !can(session, "finance.manage")) {
    return NextResponse.json({ error: "ليس لديك صلاحية" }, { status: 403 });
  }

  let towerWhere: { towerId: number | { in: number[] } };
  if (!session.isAdmin && session.towerId != null) {
    towerWhere = { towerId: session.towerId };
  } else {
    const ids = await agentTowerIds(session);
    const officeId = Number(new URL(request.url).searchParams.get("officeId"));
    towerWhere = ids.includes(officeId)
      ? { towerId: officeId }
      : { towerId: { in: ids.length ? ids : [-1] } };
  }

  const { start, end } = iraqTodayRange();
  const agg = await prisma.moneyTx.aggregate({
    where: {
      isDeleted: false,
      OR: [{ sourceType: null }, { sourceType: "manual" }],
      date: { gte: start, lte: end },
      ...towerWhere,
    },
    _sum: { moneyIn: true, moneyOut: true },
  });
  const totalIn = agg._sum.moneyIn ?? 0;
  const totalOut = agg._sum.moneyOut ?? 0;
  return NextResponse.json({ totalIn, totalOut, balance: totalIn - totalOut });
}
