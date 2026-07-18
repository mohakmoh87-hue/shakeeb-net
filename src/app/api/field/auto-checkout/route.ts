import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { runAutoCheckout } from "@/lib/autoCheckout";

export const dynamic = "force-dynamic";

// تشغيل يدوي لبصمة الخروج التلقائية (يعمل تلقائياً 00:15 بغداد عبر المجدول المحلي أيضاً).
export async function POST() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const r = await runAutoCheckout();
  return NextResponse.json({ ok: true, ...r });
}
