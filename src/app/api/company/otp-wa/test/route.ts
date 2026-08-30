import { NextResponse } from "next/server";
import { getCompanySession } from "@/lib/companyAuth";
import { sendOtpWhatsApp } from "@/lib/otpWa";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!phone) return NextResponse.json({ error: "أدخِل رقمَ الاختبار" }, { status: 400 });
  const r = await sendOtpWhatsApp(phone, "✅ رسالةُ اختبارٍ لواتساب OTP — سوبر سيل / شكيب نت.");
  return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error ?? "فشل الإرسال" });
}
