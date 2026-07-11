import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { runExpiringReminder } from "@/lib/scheduler";

// إرسال تذكير المنتهين خلال يومين يدوياً الآن (زر اختبار)
export async function POST() {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;
  const res = await runExpiringReminder();
  return NextResponse.json({ ok: true, ...res });
}
