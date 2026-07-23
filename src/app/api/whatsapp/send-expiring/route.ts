import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { runExpiringReminder } from "@/lib/scheduler";

// إرسال تذكير المنتهين خلال يومين يدوياً الآن (زر اختبار)
// عزل المستأجر: مكاتب وكيل المستخدم فقط (كان يُرسل لمشتركي كل الوكلاء)
export async function POST() {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;
  const towers = await agentTowerIds(g.session);
  const res = await runExpiringReminder(towers.length ? towers : [-1]);
  return NextResponse.json({ ok: true, ...res });
}
