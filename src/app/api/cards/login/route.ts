import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { ensureCardDistributorsTable, setCardSession, newSessionToken } from "@/lib/cardAuth";

export const dynamic = "force-dynamic";

const DUMMY_HASH = bcrypt.hashSync("cards-login-dummy", 10);
const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function POST(request: Request) {
  if (!rateLimit(`cards-login-ip:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "أدخل اسم المستخدم وكلمة المرور" }, { status: 400 });
  const { username, password } = parsed.data;
  if (!rateLimit(`cards-login-user:${username.trim().toLowerCase()}`, 10, 60_000)) {
    return NextResponse.json({ error: "محاولات كثيرة على هذا الحساب — انتظر دقيقة" }, { status: 429 });
  }

  await ensureCardDistributorsTable();
  const u = await prisma.cardDistributor.findUnique({ where: { username } });
  const ok = await verifyPassword(password, u && !u.isDeleted ? u.password : DUMMY_HASH);
  if (!u || u.isDeleted || !ok) return NextResponse.json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });

  const ag = await prisma.agent.findUnique({ where: { id: u.distributorAgentId }, select: { isDistributor: true, isDeleted: true } });
  if (!ag || ag.isDeleted || !ag.isDistributor) return NextResponse.json({ error: "الحسابُ غيرُ مفعّلٍ حاليّاً" }, { status: 403 });

  const st = newSessionToken();
  await prisma.cardDistributor.update({ where: { id: u.id }, data: { sessionToken: st } });
  await setCardSession({ kind: "distributor", distributorId: u.id, distributorAgentId: u.distributorAgentId, username: u.username, sessionToken: st });
  return NextResponse.json({ ok: true });
}
