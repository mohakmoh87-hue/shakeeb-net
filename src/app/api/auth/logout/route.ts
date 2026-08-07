import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export async function POST() {
  // (أُزيل إرسال تقرير المدير عبر واتساب عند الخروج — حلقة زائدة؛ التقارير تُرى في «حسابات المدير».)
  await clearSession();
  return NextResponse.json({ ok: true });
}
