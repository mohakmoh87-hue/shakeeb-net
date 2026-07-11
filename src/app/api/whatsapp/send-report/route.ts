import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { runManagerDailyReport } from "@/lib/scheduler";

// إرسال التقرير اليومي لهواتف المدراء يدوياً (زر "أرسل الآن")
export async function POST() {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;
  const res = await runManagerDailyReport();
  return NextResponse.json({ ok: true, ...res });
}
