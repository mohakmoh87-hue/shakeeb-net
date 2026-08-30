import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { phoneCore, verifyOtp } from "@/lib/subscriberLogin";
import { setSubscriberSession } from "@/lib/subscriberAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!rateLimit(`app-login-vrf:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const core = phoneCore(typeof body?.phone === "string" ? body.phone : "");
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!core || !code) return NextResponse.json({ error: "أدخِل الرقمَ والرمز" }, { status: 400 });
  if (!rateLimit(`app-login-vrf-phone:${core}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرةٌ لهذا الرقم، انتظر قليلاً" }, { status: 429 });
  }

  const r = await verifyOtp(core, code);
  if (!r.ok || r.subscriberId == null) return NextResponse.json({ error: r.error ?? "فشل التحقّق" }, { status: 400 });
  await setSubscriberSession(r.subscriberId);
  return NextResponse.json({ ok: true });
}
