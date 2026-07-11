import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

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

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  // اقرأ بيانات المستخدم الحالية من قاعدة البيانات (المكتب/الصلاحيات/الحالة)
  // حتى يُطبَّق أي تغيير فوراً بلا حاجة لإعادة تسجيل الدخول
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.isDeleted || !user.isActive) return null;
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    permissions: (user.permissions ?? "").split(",").filter(Boolean) as Permission[],
    towerId: user.towerId,
  };
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export const SESSION_COOKIE = COOKIE;
