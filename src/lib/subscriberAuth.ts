import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

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
