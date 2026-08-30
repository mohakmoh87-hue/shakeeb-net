import { NextResponse } from "next/server";
import { guardOwner } from "@/lib/guard";
import { sendOtpWhatsApp } from "@/lib/otpWa";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const body = await request.json().catch(() => null);
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!phone) return NextResponse.json({ error: "أدخِل رقمَ الاختبار" }, { status: 400 });
  const r = await sendOtpWhatsApp(phone, "✅ رسالةُ اختبارٍ لواتساب OTP — شكيب نت / سوبر سيل.");
  return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error ?? "فشل الإرسال" });
}
