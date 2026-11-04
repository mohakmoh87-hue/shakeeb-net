import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { phoneCore, findSubscriberByPhone, markAppLogin } from "@/lib/subscriberLogin";
import { setSubscriberSession, setAccountSession } from "@/lib/subscriberAuth";
import { ensureMarketTable } from "@/lib/market";
import { verifyPassword } from "@/lib/auth";
import { resolveTestUser } from "@/lib/appTestUsers";

export const dynamic = "force-dynamic";

// دخولُ المشترك بالهاتف + كلمة المرور (الرمزُ يبقى للتحقّق من الملكيّة عند ضبط كلمة المرور).
export async function POST(request: Request) {
  if (!rateLimit(`app-pwd-login:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const raw = typeof body?.phone === "string" ? body.phone : "";
  const core = phoneCore(raw);
  const password = typeof body?.password === "string" ? body.password : "";
  // 👤 حساباتُ التجريب (طلبُ محمد 2026-11-04): اسمٌ لا رقمُ هاتف، من سجلٍّ في الإعدادات.
  //    مسارٌ **بجانب** القديم لا فوقه، وبلا `markAppLogin` — فلا جائزةَ «تنصيب تطبيق»
  //    لفنيٍّ من دخولٍ تجريبيّ.
  if (!core && password) {
    const t = await resolveTestUser(raw);
    if (t) {
      if (!rateLimit(`app-test-login:${t.user}`, 10, 10 * 60_000)) {
        return NextResponse.json({ error: "محاولاتٌ كثيرةٌ لهذا الحساب، انتظر قليلاً" }, { status: 429 });
      }
      if (t.subscriberId != null) {
        const sub = await prisma.subscriber.findFirst({
          where: { id: t.subscriberId, isDeleted: false, purgedAt: null },
          select: { id: true, appBanned: true, appPasswordHash: true },
        });
        if (!sub) return NextResponse.json({ status: "not_subscriber" });
        if (sub.appBanned) return NextResponse.json({ status: "banned", error: "حُظِر حسابُك من التطبيق — راجِع الدعم" }, { status: 403 });
        if (!sub.appPasswordHash || !(await verifyPassword(password, sub.appPasswordHash))) {
          return NextResponse.json({ status: "wrong_password", error: "كلمةُ المرور غير صحيحة" }, { status: 401 });
        }
        await setSubscriberSession(sub.id);
        return NextResponse.json({ ok: true });
      }
      await ensureMarketTable();
      const acc = t.accountId != null
        ? await prisma.appAccount.findUnique({ where: { id: t.accountId }, select: { id: true, isBanned: true, passHash: true } })
        : null;
      if (!acc) return NextResponse.json({ status: "not_subscriber" });
      if (acc.isBanned) return NextResponse.json({ status: "banned", error: "حُظِر حسابُك من التطبيق — راجِع الدعم" }, { status: 403 });
      if (!acc.passHash || !(await verifyPassword(password, acc.passHash))) {
        return NextResponse.json({ status: "wrong_password", error: "كلمةُ المرور غير صحيحة" }, { status: 401 });
      }
      await setAccountSession(acc.id);
      return NextResponse.json({ ok: true, kind: "account" });
    }
  }
  if (!core || !password) return NextResponse.json({ status: "invalid", error: "أدخِل الرقمَ وكلمةَ المرور" }, { status: 400 });
  if (!rateLimit(`app-pwd-login-phone:${core}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرةٌ لهذا الرقم، انتظر قليلاً" }, { status: 429 });
  }

  const sub = await findSubscriberByPhone(core);
  // 👤 ليس مشتركاً ⇒ قد يكون صاحبَ حسابِ «غير مشترك» بكلمة مرورٍ (طلبُ محمد 2026-10-28):
  //    نفسُ الخانتَين تخدم الاثنين، فلا شاشةَ دخولٍ ثانية.
  if (!sub) {
    await ensureMarketTable();
    const acc = await prisma.appAccount.findUnique({
      where: { phoneCore: core },
      select: { id: true, isBanned: true, passHash: true },
    });
    if (!acc) return NextResponse.json({ status: "not_subscriber" });
    if (acc.isBanned) return NextResponse.json({ status: "banned", error: "حُظِر حسابُك من التطبيق — راجِع الدعم" }, { status: 403 });
    if (!acc.passHash) {
      return NextResponse.json({ status: "no_password", error: "لم تُضبَط كلمةُ مرورٍ لهذا الحساب — ادخل عبر الرمز أوّلاً" }, { status: 400 });
    }
    if (!(await verifyPassword(password, acc.passHash))) {
      return NextResponse.json({ status: "wrong_password", error: "كلمةُ المرور غير صحيحة" }, { status: 401 });
    }
    await setAccountSession(acc.id);
    return NextResponse.json({ ok: true, kind: "account" });
  }
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
