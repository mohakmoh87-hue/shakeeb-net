import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// مفتاح توقيع الجلسة: مطلوب في الإنتاج (فشل واضح إن غاب بدل استخدام مفتاح عام صامت)
// يُستثنى طور البناء: Cloud Build يقيّم الوحدات أثناء «جمع بيانات الصفحات» بلا متغيرات
// بيئة (الأسرار تُحقن وقت التشغيل فقط) — الفشل الصريح يبقى قائماً عند الإقلاع الفعلي.
if (
  !process.env.AUTH_SECRET &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("AUTH_SECRET غير مضبوط في الإنتاج — أوقف التشغيل بدل استخدام مفتاح افتراضي عام");
}
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-secret-change-me",
);
const COOKIE = "mynet_session";
// جلسة طويلة الأمد (سنة كاملة) — يبقى تسجيل الدخول محفوظاً في التطبيق (APK/PWA) والمتصفح
// «للأبد» حتى تسجيل الخروج الصريح. الأمان محفوظ: getSession/getTechSession يعيدان التحقق من
// القاعدة في كل طلب، فتعطيل/حذف الحساب يُنهي الجلسة فوراً مهما طال عمر التوكن.
const MAX_AGE = 60 * 60 * 24 * 365; // سنة

import type { Permission } from "./rbac";
import { isAgentBlocked } from "./agentPlan";
import { ensurePermSplitBackfillOnce } from "./permSplitBackfill";

export interface SessionPayload {
  userId: number;
  username: string;
  fullName: string;
  isAdmin: boolean;
  isOwner: boolean; // مالك النظام (فوق المدير) — يدير الوكلاء فقط
  agentId: number | null; // الوكيل (المستأجر) الذي ينتمي إليه المستخدم
  permissions: Permission[];
  // مديرٌ بصلاحيّاتٍ محدَّدة (طلبُ محمد): منعٌ صريحٌ **يسبق** كلَّ منح — انظر `rbac.can`
  deniedPermissions: string[];
  towerId: number | null; // مكتب المستخدم (المكتب)
  sessionToken?: string; // جلسة واحدة: يُطابَق مع users.sessionToken؛ أي دخول جديد يُبطل القديم
}

// تشفير كلمة السر والتحقق منها
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// إنشاء توكن الجلسة (JWT)
export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(SECRET);
}

export async function verifyToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    // تثبيت الخوارزمية على HS256 حصراً (دفاع في العمق): يمنع أي توكن موقّع بخوارزمية
    // أخرى (none/RS256) — كل توكناتنا HS256 فلا أثر على الجلسات القائمة أو الجديدة.
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// كتابة/قراءة/حذف كوكي الجلسة
export async function setSession(payload: SessionPayload) {
  const token = await createToken(payload);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

// ===== جلسة الفني (تطبيق إدارة الفنيين) — منفصلة عن جلسة المستخدم بنفس الكوكي عبر kind =====
export interface TechSessionPayload {
  kind: "technician";
  technicianId: number;
  name: string;
  username: string;
  agentId: number | null;
  towerId: number | null;
  // جهاز واحد فقط: رمز جلسة يتجدّد بكل تسجيل دخول ويُخزَّن على صف الفني —
  // الدخول من جهاز جديد يُبطل جلسة الجهاز السابق فوراً
  sessionToken?: string;
}
export async function setTechSession(payload: TechSessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(SECRET);
  const store = await cookies();
  store.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
}
// يقرأ جلسة الفني الحالية (ويعيد بياناته المحدّثة من القاعدة). null إن لم تكن جلسة فني.
export async function getTechSession(): Promise<TechSessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || (payload as unknown as { kind?: string }).kind !== "technician") return null;
  const p = payload as unknown as TechSessionPayload;
  const tech = await prisma.technician.findUnique({ where: { id: p.technicianId }, select: { id: true, name: true, username: true, agentId: true, towerId: true, isDeleted: true, sessionToken: true } });
  if (!tech || tech.isDeleted) return null;
  // جهاز واحد فقط: رمز الجلسة يجب أن يطابق آخر تسجيل دخول — دخول جهاز جديد يُبطل السابق.
  // (جلسات ما قبل الميزة: صف الفني بلا رمز ⇒ تُقبل حتى أول دخول جديد يثبّت رمزاً)
  if (tech.sessionToken && p.sessionToken !== tech.sessionToken) return null;
  // اشتراكُ الوكيل: الممنوعُ تُبطَل جلسةُ فنيّيه فوراً — لا عند الدخول وحدَه
  if (await isAgentBlocked(tech.agentId)) return null;
  return { kind: "technician", technicianId: tech.id, name: tech.name, username: tech.username ?? "", agentId: tech.agentId, towerId: tech.towerId, sessionToken: p.sessionToken };
}

// ===== 👁️ جلسة مستخدم المشاهدة — نوعٌ ثالثٌ بنفس الكوكي عبر kind (طلبُ محمد 2026-11-21) =====
// 🔑 **ولماذا نوعٌ مستقلٌّ لا مستخدمٌ بلا صلاحيّات؟** لأنّ أربعين مساراً يستعمل
// `getSession()` بلا حارسِ صلاحيّة (ومنها `money/summary` و`reports/daily`) ⇒ جلسةُ
// مستخدمٍ عاديّةٍ كانت ستُجيبه ولو أخفت الواجهةُ أزرارَها. والقائمةُ البيضاء في
// `getSession` (ترفض كلَّ توكنٍ يحمل `kind`) تُغلق المسارات والصفحات **كلَّها** بصفر تعديل.
export interface ViewerSessionPayload {
  kind: "viewer";
  userId: number;
  name: string;
  username: string;
  agentId: number | null;
  towerId: number | null;
  viewAllOffices: boolean; // نطاقُه: مكتبُه وحدَه أو كلُّ مكاتب وكيله
  sessionToken?: string;
}
export async function setViewerSession(payload: ViewerSessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(SECRET);
  const store = await cookies();
  store.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
}
// يقرأ جلسة المشاهد (وبياناته المحدّثة من القاعدة). null إن لم تكن جلسةَ مشاهد.
// النطاقُ والمكتبُ يُقرآن من القاعدة لا من التوكن — فتعديلُ المدير يسري فوراً،
// وسحبُ صفة المشاهدة (`viewOnly=false`) يُبطل الجلسةَ بدل أن يُوسّعها صامتاً.
export async function getViewerSession(): Promise<ViewerSessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || (payload as unknown as { kind?: string }).kind !== "viewer") return null;
  const p = payload as unknown as ViewerSessionPayload;
  const u = await prisma.user.findUnique({
    where: { id: p.userId },
    select: { id: true, fullName: true, username: true, agentId: true, towerId: true, viewOnly: true, viewAllOffices: true, isDeleted: true, isActive: true, isOwner: true, sessionToken: true },
  });
  if (!u || u.isDeleted || !u.isActive || u.isOwner || !u.viewOnly) return null;
  if (u.sessionToken && p.sessionToken !== u.sessionToken) return null;
  if (await isAgentBlocked(u.agentId)) return null;
  return {
    kind: "viewer", userId: u.id, name: u.fullName, username: u.username,
    agentId: u.agentId, towerId: u.towerId, viewAllOffices: u.viewAllOffices,
    sessionToken: p.sessionToken,
  };
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  // جلسةُ المستخدم لا تحمل kind؛ أيُّ توكنٍ يحمل نوعاً (فنّي/موزّع كروت/أدمن تطبيق…) ليس جلسةَ
  // مستخدمٍ فيُرفض هنا — قائمةٌ بيضاءُ لا سوداء، فلا يمرّ نوعٌ جديدٌ مستقبلاً بلا userId ويرمي 500.
  if ((payload as unknown as { kind?: string }).kind != null) return null;

  // ردمُ فكِّ ربط الصلاحيّات (2026-08-29): يُثبّت الابنَ المُستلزَمَ صراحةً مرّةً واحدةً
  // **قبل** قراءة الصلاحيّات أدناه، فلا فجوةَ يُزال فيها الاستلزامُ قبل الردم. راجع permSplitBackfill.
  await ensurePermSplitBackfillOnce();

  // اقرأ بيانات المستخدم الحالية من قاعدة البيانات (المكتب/الصلاحيات/الحالة)
  // حتى يُطبَّق أي تغيير فوراً بلا حاجة لإعادة تسجيل الدخول
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.isDeleted || !user.isActive) return null;
  // جلسة واحدة: إن كان للمستخدم رمز جلسة مخزّن ولم يطابق رمز التوكن ⇒ أُبطلت هذه الجلسة
  // (سجّل دخوله من جهاز آخر فحلّ محلّه). يبقى القدماء (بلا رمز) صالحين حتى دخولهم القادم.
  const ptok = (payload as unknown as { sessionToken?: string }).sessionToken;
  if (user.sessionToken && ptok !== user.sessionToken) return null;
  // اشتراكُ الوكيل: الممنوعُ (منتهٍ بعد مهلة السماح · مسحوبُ الموافقة · محذوف) تُبطَل
  // جلساتُ فريقه كلِّها فوراً. المالكُ (بلا وكيل) غيرُ معنيٍّ فلا استعلامَ له إطلاقاً.
  if (await isAgentBlocked(user.agentId)) return null;
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    isOwner: user.isOwner,
    agentId: user.agentId,
    permissions: (user.permissions ?? "").split(",").filter(Boolean) as Permission[],
    deniedPermissions: (user.deniedPermissions ?? "").split(",").filter(Boolean),
    towerId: user.towerId,
    sessionToken: user.sessionToken ?? undefined,
  };
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export const SESSION_COOKIE = COOKIE;
