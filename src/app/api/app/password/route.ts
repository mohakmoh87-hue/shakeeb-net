import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { getSubscriberSession, clearSubscriberSession } from "@/lib/subscriberAuth";
import { hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const MIN_APP_PASSWORD = 6;

// 🔑 ضبطُ كلمة مرور المشترك للتطبيق (طلبُ محمد 2026-10-24).
// كان `appPasswordHash` **يُقرأ ولا يُكتَب في أيّ مكان** — فلا سبيلَ لضبط كلمةِ مرورٍ
// أصلاً، ولذلك كان رمزُ واتساب يفتح التطبيقَ مباشرةً. الآن: الرمزُ يُثبت الملكيّةَ
// ويفتح جلسةً قصيرة، وهذه الجلسةُ تأذن بضبط الكلمة، ثمّ **تُبطَل فوراً** فيعود
// المشتركُ إلى شاشة الدخول ليدخل بكلمته الجديدة — كما طلب محمد.
export async function POST(request: Request) {
  if (!rateLimit(`app-set-pwd:${clientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: "محاولاتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  // 🔒 لا تُضبَط كلمةُ مرورِ أحدٍ إلّا بجلسته هو — والجلسةُ لا تُفتَح إلّا برمزِ واتساب
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "انتهت الجلسة — أعد طلبَ الرمز" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";
  if (password.length < MIN_APP_PASSWORD) {
    return NextResponse.json({ error: `كلمةُ المرور ${MIN_APP_PASSWORD} أحرفٍ على الأقلّ` }, { status: 400 });
  }
  if (password.length > 64) return NextResponse.json({ error: "كلمةُ المرور طويلةٌ جدّاً" }, { status: 400 });
  if (confirm !== password) return NextResponse.json({ error: "الكلمتان غير متطابقتَين" }, { status: 400 });

  const sub = await prisma.subscriber.findFirst({
    where: { id: sess.subscriberId, isDeleted: false, purgedAt: null },
    select: { id: true, appBanned: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (sub.appBanned) return NextResponse.json({ error: "حُظِر حسابُك من التطبيق — راجِع الدعم" }, { status: 403 });

  await prisma.subscriber.update({ where: { id: sub.id }, data: { appPasswordHash: await hashPassword(password) } });
  // إبطالُ الجلسة: الرمزُ كان لإثبات الملكيّة لا لفتح التطبيق
  await clearSubscriberSession();
  return NextResponse.json({ ok: true });
}
