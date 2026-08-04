import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { computeDailyReport } from "@/lib/dailyReport";

export const dynamic = "force-dynamic";

// التقرير اليومي لمكتب محدّد أو الإجمالي (لتبويبات تقرير المدير في الشاشة الرئيسية).
// المدير: يختار أي مكتب أو الإجمالي (towerId=all). مستخدم المكتب: مكتبه فقط دائماً.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const param = new URL(request.url).searchParams.get("towerId");
  const agentTowers = await agentTowerIds(session);
  let scope: number | number[] | null;
  if (session.isAdmin) {
    // الإجمالي = كل مكاتب الوكيل؛ مكتب محدّد = فقط إن كان ضمن وكيله
    if (!param || param === "all") scope = agentTowers;
    else { const t = Number(param) || -1; scope = agentTowers.includes(t) ? t : -1; }
  } else {
    // مستخدم المكتب مقيّد بمكتبه؛ ومَن بلا مكتب يُقيَّد **بمكاتب وكيله** لا بـnull —
    // لأن null كان يعني «بلا فلتر» فيرى مال كل المكاتب في القاعدة بما فيها وكلاء آخرون
    // (خرق عزل + مبالغ ضخمة بلا مصدر). وبلا مكاتب لوكيله: لا شيء.
    scope = session.towerId ?? (agentTowers.length ? agentTowers : [-1]);
  }

  const r = await computeDailyReport(scope);
  return NextResponse.json(r);
}
