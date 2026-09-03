import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { phoneCore, findSubscriberByPhone, markAppLogin } from "@/lib/subscriberLogin";
import { setSubscriberSession } from "@/lib/subscriberAuth";
import { verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// دخولُ المشترك بالهاتف + كلمة المرور (الرمزُ يبقى للتحقّق من الملكيّة عند ضبط كلمة المرور).
export async function POST(request: Request) {
  if (!rateLimit(`app-pwd-login:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const core = phoneCore(typeof body?.phone === "string" ? body.phone : "");
  const password = typeof body?.password === "string" ? body.password : "";
  if (!core || !password) return NextResponse.json({ status: "invalid", error: "أدخِل الرقمَ وكلمةَ المرور" }, { status: 400 });
  if (!rateLimit(`app-pwd-login-phone:${core}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرةٌ لهذا الرقم، انتظر قليلاً" }, { status: 429 });
  }

  const sub = await findSubscriberByPhone(core);
  if (!sub) return NextResponse.json({ status: "not_subscriber" });
  if (sub.appBanned) return NextResponse.json({ status: "banned", error: "حُظِر حسابُك من التطبيق — راجِع الدعم" }, { status: 403 });

  const row = await prisma.subscriber.findUnique({ where: { id: sub.id }, select: { appPasswordHash: true } });
  if (!row?.appPasswordHash) {
    return NextResponse.json({ status: "no_password", error: "لم تُضبَط كلمةُ مرورٍ لهذا الحساب — ادخل عبر الرمز أوّلاً" }, { status: 400 });
  }
  if (!(await verifyPassword(password, row.appPasswordHash))) {
    return NextResponse.json({ status: "wrong_password", error: "كلمةُ المرور غير صحيحة" }, { status: 401 });
  }

  await setSubscriberSession(sub.id);
  await markAppLogin(sub.id);
  return NextResponse.json({ ok: true });
}
