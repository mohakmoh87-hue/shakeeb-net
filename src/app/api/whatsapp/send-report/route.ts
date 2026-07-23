import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { runManagerDailyReport } from "@/lib/scheduler";

// إرسال التقرير اليومي لهواتف المدراء يدوياً (زر "أرسل الآن")
// عزل المستأجر: تقارير مكاتب وكيل المستخدم فقط (كان يُرسل لمدراء كل الوكلاء)
export async function POST() {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;
  const towers = await agentTowerIds(g.session);
  const res = await runManagerDailyReport(towers.length ? towers : [-1]);
  return NextResponse.json({ ok: true, ...res });
}
