import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "./prisma";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");
const COOKIE = "kabina_cards";
const MAX_AGE = 60 * 60 * 24 * 365;

export interface CardSessionPayload {
  kind: "distributor";
  distributorId: number;
  distributorAgentId: number;
  username: string;
  sessionToken?: string;
}

let tableReady = false;
export async function ensureCardDistributorsTable(): Promise<void> {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "card_distributors" (
      "id" SERIAL PRIMARY KEY,
      "distributorAgentId" INTEGER NOT NULL,
      "username" TEXT NOT NULL UNIQUE,
      "password" TEXT NOT NULL,
      "plainPassword" TEXT,
      "sessionToken" TEXT,
      "isDeleted" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "card_distributors_distributorAgentId_key" ON "card_distributors"("distributorAgentId")`);
  tableReady = true;
}

export function newSessionToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function setCardSession(payload: CardSessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(SECRET);
  const store = await cookies();
  store.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
}

export async function clearCardSession() {
  const store = await cookies();
  store.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
}

export async function getCardSession(): Promise<CardSessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  let payload: CardSessionPayload;
  try {
    const { payload: p } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    if ((p as { kind?: string }).kind !== "distributor") return null;
    payload = p as unknown as CardSessionPayload;
  } catch {
    return null;
  }
  try {
    await ensureCardDistributorsTable();
    const row = await prisma.cardDistributor.findUnique({
      where: { id: payload.distributorId },
      select: { id: true, distributorAgentId: true, username: true, isDeleted: true, sessionToken: true },
    });
    if (!row || row.isDeleted) return null;
    if (row.sessionToken && payload.sessionToken !== row.sessionToken) return null;
    const ag = await prisma.agent.findUnique({ where: { id: row.distributorAgentId }, select: { isDistributor: true, isDeleted: true } });
    if (!ag || ag.isDeleted || !ag.isDistributor) return null;
    return { kind: "distributor", distributorId: row.id, distributorAgentId: row.distributorAgentId, username: row.username, sessionToken: payload.sessionToken };
  } catch {
    return null;
  }
}
