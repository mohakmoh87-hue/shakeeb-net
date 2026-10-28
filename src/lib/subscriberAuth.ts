import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { subscriberState } from "./subscriberLogin";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");
const COOKIE = "kabina_subscriber";
const MAX_AGE = 60 * 60 * 24 * 90;

export async function setSubscriberSession(subscriberId: number) {
  const token = await new SignJWT({ kind: "subscriber", subscriberId })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(SECRET);
  const store = await cookies();
  store.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
}

export async function clearSubscriberSession() {
  const store = await cookies();
  store.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
}

export async function getSubscriberSession(): Promise<{ subscriberId: number } | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    if ((payload as { kind?: string }).kind !== "subscriber") return null;
    const subscriberId = Number((payload as { subscriberId?: number }).subscriberId);
    if (!Number.isFinite(subscriberId)) return null;
    const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { id: true, isDeleted: true, purgedAt: true } });
    if (!sub || sub.isDeleted || sub.purgedAt) return null;
    return { subscriberId };
  } catch {
    return null;
  }
}

// ═════ 👤 جلسةُ «غير المشترك» — نفسُ الكوكي بنوعٍ مغاير ═════
// 🔒 الأمانُ ببنيته لا بحذرِ المحرّر: `getSubscriberSession` أعلاه ترفض كلَّ ما
//    `kind` فيه ليس "subscriber"، فحسابُ غير المشترك **لا يصل إلى أيّ مسارِ مشتركٍ
//    قائمٍ أبداً** بلا أن نعدّل فيها حرفاً. وما نريد فتحَه للاثنين يُنادي `appViewer`.

export async function setAccountSession(accountId: number) {
  const token = await new SignJWT({ kind: "account", accountId })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(SECRET);
  const store = await cookies();
  store.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
}

export async function getAccountSession(): Promise<{ accountId: number } | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    if ((payload as { kind?: string }).kind !== "account") return null;
    const accountId = Number((payload as { accountId?: number }).accountId);
    if (!Number.isFinite(accountId)) return null;
    const acc = await prisma.appAccount.findUnique({ where: { id: accountId }, select: { id: true, isBanned: true } });
    if (!acc || acc.isBanned) return null;
    return { accountId };
  } catch {
    return null;
  }
}

export type AppViewer =
  | { kind: "subscriber"; subscriberId: number }
  | { kind: "account"; accountId: number }
  | null;

// من يتصفّح الآن؟ مشتركٌ أم حسابُ غير مشترك أم زائرٌ بلا جلسة.
export async function appViewer(): Promise<AppViewer> {
  const sub = await getSubscriberSession();
  if (sub) return { kind: "subscriber", subscriberId: sub.subscriberId };
  const acc = await getAccountSession();
  if (acc) return { kind: "account", accountId: acc.accountId };
  return null;
}

// ═════ 🔓 صنفُ الجمهور — قاعدةُ محمد 2026-10-27 ═════
// «الغير مشترك والمنتهي لمدة أكثر من شهر والضيف… الثلاثة يعتبرون هم نفس الشيء».
// فالفيصلُ **ليس** وجودَ جلسةٍ (كما كان) بل حالةُ الاشتراك: النشطُ والمنتهي أقلَّ من
// شهرٍ جمهورُ "subs"، ومن تجاوز الشهرَ يُرَى **زائراً** في كلّ ما يُعرَض ويُخفى.
// والشهرُ هو `GRACE_DAYS` في `subscriberLogin` — مصدرٌ واحدٌ للحدّ لا رقمٌ مكرَّر.
// 🔒 يبقى `subscriberId` مُعاداً لمن له جلسةٌ حقيقيّة: بياناتُه وإشعاراتُه وطلباتُه
//    له وحدَه (قرارُ محمد: «تبقى له») — الصنفُ يحكم المعروضَ لا ملكيّةَ حسابه.
export async function appAudience(): Promise<{ audience: "subs" | "guests"; subscriberId: number | null }> {
  const c = await appClass();
  // المشتركُ النشطُ (ومنه المنتهي أقلَّ من شهر) وحدَه جمهورُ "subs"؛ والثلاثةُ الباقية سواء.
  return { audience: c.klass === "sub_active" ? "subs" : "guests", subscriberId: c.subscriberId };
}

// ═════ 🎯 صنفُ المتصفّح بدقّة — طلبُ محمد 2026-10-28 ═════
// جمهورُ العرض الخاصّ صار يُختار من أربعةٍ لا ثلاثة: مشتركٌ فعّال · مشتركٌ منتهٍ · غيرُ
// مشتركٍ (له حساب) · زائرٌ بلا جلسة. و`appAudience` أعلاه تبقى الاختزالَ الثنائيَّ الذي
// تحتاجه النوافذُ المنبثقةُ — مصدرُ حقيقةٍ واحدٌ لا حسابان متوازيان.
// 🔒 والصنفُ من الكوكي وحدَها: لا يُقبَل من الطلب بحالٍ.
export type AppClass = "sub_active" | "sub_expired" | "account" | "guest";
export async function appClass(): Promise<{ klass: AppClass; subscriberId: number | null; packageId: number | null }> {
  const sess = await getSubscriberSession();
  if (sess) {
    const row = await prisma.subscriber.findUnique({
      where: { id: sess.subscriberId },
      select: { dateTo: true, packageId: true },
    });
    const st = subscriberState(row?.dateTo ?? null);
    return {
      klass: st.state === "expired" ? "sub_expired" : "sub_active",
      subscriberId: sess.subscriberId,
      packageId: row?.packageId ?? null,
    };
  }
  const acc = await getAccountSession();
  return { klass: acc ? "account" : "guest", subscriberId: null, packageId: null };
}
