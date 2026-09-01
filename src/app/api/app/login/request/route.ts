import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { phoneCore, findSubscriberByPhone, subscriberState, issueOtp } from "@/lib/subscriberLogin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!rateLimit(`app-login-req:${clientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const core = phoneCore(typeof body?.phone === "string" ? body.phone : "");
  if (!core) return NextResponse.json({ status: "invalid_phone", error: "رقمُ هاتفٍ غير صالح" }, { status: 400 });
  if (!rateLimit(`app-login-req-phone:${core}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: "طلباتٌ كثيرةٌ لهذا الرقم، انتظر قليلاً" }, { status: 429 });
  }

  const sub = await findSubscriberByPhone(core);
  if (!sub) return NextResponse.json({ status: "not_subscriber" });
  // حظرُ أدمن التطبيق: يُمنَع الدخولُ قبل إرسال أيّ رمز
  if (sub.appBanned) return NextResponse.json({ status: "banned", error: "حُظِر حسابُك من التطبيق — راجِع الدعم" }, { status: 403 });

  const st = subscriberState(sub.dateTo);
  if (st.state === "expired") return NextResponse.json({ status: "expired", days: st.daysExpired });

  const r = await issueOtp(core, sub.id, sub.phone ?? core);
  if (!r.ok) return NextResponse.json({ status: "send_failed", error: r.error ?? "تعذّر إرسالُ الرمز" }, { status: 502 });
  return NextResponse.json({ status: "otp_sent" });
}
