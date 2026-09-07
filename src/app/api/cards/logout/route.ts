import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCardSession, clearCardSession, newSessionToken } from "@/lib/cardAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  const s = await getCardSession();
  if (s) await prisma.cardDistributor.update({ where: { id: s.distributorId }, data: { sessionToken: newSessionToken() } }).catch(() => {});
  await clearCardSession();
  return NextResponse.json({ ok: true });
}
