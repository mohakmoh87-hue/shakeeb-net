import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { computeDailyReport, reportUserScope } from "@/lib/dailyReport";

export const dynamic = "force-dynamic";

// التقرير اليومي لمكتب محدّد أو الإجمالي (لتبويبات تقرير المدير في الشاشة الرئيسية).
// المدير: يختار أي مكتب أو الإجمالي (towerId=all)، ولمكتبٍ فيه مستخدمان+ يختار المستخدم (userId).
// مستخدم المكتب: مكتبه فقط دائماً — وإن كان بمكتبه مستخدمان+ يُجبَر على تقريره هو وحده.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const param = sp.get("towerId");
  const agentTowers = await agentTowerIds(session);
  let scope: number | number[] | null;
  let userId: number | undefined;
  if (session.isAdmin) {
    // الإجمالي = كل مكاتب الوكيل؛ مكتب محدّد = فقط إن كان ضمن وكيله
    if (!param || param === "all") scope = agentTowers;
    else { const t = Number(param) || -1; scope = agentTowers.includes(t) ? t : -1; }
    // اختيار مستخدمٍ محدّد (لمكتبٍ فيه مستخدمان+) — يُقبل فقط إن كان المستخدم من وكيله
    const uParam = Number(sp.get("userId")) || 0;
    if (uParam > 0) {
      const u = await prisma.user.findFirst({ where: { id: uParam, agentId: session.agentId ?? -1, isDeleted: false }, select: { id: true } });
      if (u) userId = u.id;
    }
  } else {
    // مستخدم المكتب مقيّد بمكتبه؛ ومَن بلا مكتب يُقيَّد **بمكاتب وكيله** لا بـnull —
    // لأن null كان يعني «بلا فلتر» فيرى مال كل المكاتب في القاعدة بما فيها وكلاء آخرون
    // (خرق عزل + مبالغ ضخمة بلا مصدر). وبلا مكاتب لوكيله: لا شيء.
    scope = session.towerId ?? (agentTowers.length ? agentTowers : [-1]);
    // مكتبٌ فيه مستخدمان+ ⇒ تقريره هو وحده (إجباريّ — لا يُقبل userId من العميل)
    userId = await reportUserScope(session);
  }

  const r = await computeDailyReport(scope, undefined, userId);
  return NextResponse.json(r);
}
