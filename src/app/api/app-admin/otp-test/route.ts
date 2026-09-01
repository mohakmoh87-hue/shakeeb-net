import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppAdminSession } from "@/lib/appAdminAuth";
import { sendOtpWhatsApp } from "@/lib/otpWa";
import { phoneCore } from "@/lib/subscriberLogin";

export const dynamic = "force-dynamic";

const schema = z.object({ phone: z.string().min(1) });

// اختبارُ ربط واتساب OTP — يُرسِل رسالةَ اختبارٍ للرقم المُدخَل (احفظ أوّلاً ثمّ اختبر).
export async function POST(request: Request) {
  const s = await getAppAdminSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخِل رقم الاختبار" }, { status: 400 });
  const core = phoneCore(parsed.data.phone);
  if (!core) return NextResponse.json({ error: "رقمٌ غير صالح (07XXXXXXXXX)" }, { status: 400 });
  const r = await sendOtpWhatsApp(core, "رسالةُ اختبارٍ من أدمن تطبيق سوبر سيل — الربطُ يعمل ✅");
  if (!r.ok) return NextResponse.json({ error: r.error ?? "فشل الإرسال" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
