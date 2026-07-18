import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// مفتاح توقيع الجلسة: مطلوب في الإنتاج (فشل واضح إن غاب بدل استخدام مفتاح عام صامت)
if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET غير مضبوط في الإنتاج — أوقف التشغيل بدل استخدام مفتاح افتراضي عام");
}
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-secret-change-me",
);
const COOKIE = "mynet_session";
const MAX_AGE = 60 * 60 * 8; // 8 ساعات

import type { Permission } from "./rbac";

export interface SessionPayload {
  userId: number;
  username: string;
  fullName: string;
  isAdmin: boolean;
  isOwner: boolean; // مالك النظام (فوق المدير) — يدير الوكلاء فقط
  agentId: number | null; // الوكيل (المستأجر) الذي ينتمي إليه المستخدم
  permissions: Permission[];
  towerId: number | null; // مكتب المستخدم (المكتب)
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
    const { payload } = await jwtVerify(token, SECRET);
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
  const tech = await prisma.technician.findUnique({ where: { id: p.technicianId }, select: { id: true, name: true, username: true, agentId: true, towerId: true, isDeleted: true } });
  if (!tech || tech.isDeleted) return null;
  return { kind: "technician", technicianId: tech.id, name: tech.name, username: tech.username ?? "", agentId: tech.agentId, towerId: tech.towerId };
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  // جلسة فني ليست جلسة مستخدم — تُرفض في كل مسارات المستخدم للحفاظ على الأمان
  if ((payload as unknown as { kind?: string }).kind === "technician") return null;

  // اقرأ بيانات المستخدم الحالية من قاعدة البيانات (المكتب/الصلاحيات/الحالة)
  // حتى يُطبَّق أي تغيير فوراً بلا حاجة لإعادة تسجيل الدخول
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.isDeleted || !user.isActive) return null;
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    isOwner: user.isOwner,
    agentId: user.agentId,
    permissions: (user.permissions ?? "").split(",").filter(Boolean) as Permission[],
    towerId: user.towerId,
  };
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export const SESSION_COOKIE = COOKIE;
