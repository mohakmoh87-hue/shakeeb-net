import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { encryptSecret } from "@/lib/secretbox";
import { getCardSession, setCardSession, newSessionToken } from "@/lib/cardAuth";

export const dynamic = "force-dynamic";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });

export async function POST(request: Request) {
  const s = await getCardSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "كلمةُ المرور الجديدة ٨ أحرفٍ فأكثر" }, { status: 400 });

  const row = await prisma.cardDistributor.findUnique({ where: { id: s.distributorId } });
  if (!row || row.isDeleted || !(await verifyPassword(parsed.data.currentPassword, row.password))) {
    return NextResponse.json({ error: "كلمةُ المرور الحاليّة غير صحيحة" }, { status: 400 });
  }

  const st = newSessionToken();
  await prisma.cardDistributor.update({
    where: { id: row.id },
    data: { password: await hashPassword(parsed.data.newPassword), plainPassword: encryptSecret(parsed.data.newPassword), sessionToken: st },
  });
  await setCardSession({ kind: "distributor", distributorId: row.id, distributorAgentId: row.distributorAgentId, username: row.username, sessionToken: st });
  return NextResponse.json({ ok: true });
}
