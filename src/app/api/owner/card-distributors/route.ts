import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";
import { hashPassword } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/secretbox";
import { ensureCardDistributorsTable, newSessionToken } from "@/lib/cardAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;
  await ensureCardDistributorsTable();

  const [agents, accounts, targets] = await Promise.all([
    prisma.agent.findMany({ where: { isDeleted: false }, orderBy: { id: "asc" }, select: { id: true, name: true, isDistributor: true } }),
    prisma.cardDistributor.findMany({ where: { isDeleted: false }, select: { id: true, distributorAgentId: true, username: true, plainPassword: true } }),
    prisma.distributorTarget.findMany({ where: { isDeleted: false }, select: { distributorId: true, targetAgentId: true } }),
  ]);
  const accByAgent = new Map(accounts.map((a) => [a.distributorAgentId, a]));
  const targetsByDist = new Map<number, number[]>();
  for (const t of targets) { const arr = targetsByDist.get(t.distributorId) ?? []; arr.push(t.targetAgentId); targetsByDist.set(t.distributorId, arr); }

  const distributors = agents
    .filter((a) => a.isDistributor || accByAgent.has(a.id))
    .map((a) => {
      const acc = accByAgent.get(a.id);
      return {
        agentId: a.id,
        name: a.name,
        isDistributor: a.isDistributor,
        username: acc?.username ?? null,
        plainPassword: acc ? decryptSecret(acc.plainPassword) : null,
        targets: acc ? (targetsByDist.get(acc.id) ?? []) : [],
      };
    });

  return NextResponse.json({ distributors, allAgents: agents.map((a) => ({ id: a.id, name: a.name })) });
}

const createSchema = z.object({ action: z.literal("create"), agentId: z.number().int(), username: z.string().regex(/^[A-Za-z0-9._-]+$/), password: z.string().min(8) });
const resetSchema = z.object({ action: z.literal("reset"), agentId: z.number().int(), password: z.string().min(8) });
const toggleSchema = z.object({ action: z.enum(["enable", "disable"]), agentId: z.number().int() });
const targetSchema = z.object({ action: z.enum(["addTarget", "removeTarget"]), agentId: z.number().int(), targetAgentId: z.number().int() });

export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  await ensureCardDistributorsTable();
  const body = await request.json().catch(() => null);
  const action = (body as { action?: string } | null)?.action;

  if (action === "create") {
    const p = createSchema.safeParse(body);
    if (!p.success) return NextResponse.json({ error: "بياناتٌ غير صحيحة (المستخدم أحرفٌ لاتينيّة، والباسورد ٨ فأكثر)" }, { status: 400 });
    const agent = await prisma.agent.findFirst({ where: { id: p.data.agentId, isDeleted: false }, select: { id: true } });
    if (!agent) return NextResponse.json({ error: "الوكيلُ غير موجود" }, { status: 404 });
    const clash = await prisma.cardDistributor.findFirst({ where: { username: p.data.username, isDeleted: false, NOT: { distributorAgentId: p.data.agentId } }, select: { id: true } });
    if (clash) return NextResponse.json({ error: "اسمُ المستخدم مستعمَل" }, { status: 409 });
    const data = { username: p.data.username, password: await hashPassword(p.data.password), plainPassword: encryptSecret(p.data.password), sessionToken: newSessionToken(), isDeleted: false };
    const existing = await prisma.cardDistributor.findUnique({ where: { distributorAgentId: p.data.agentId }, select: { id: true } });
    if (existing) await prisma.cardDistributor.update({ where: { id: existing.id }, data });
    else await prisma.cardDistributor.create({ data: { distributorAgentId: p.data.agentId, ...data } });
    await prisma.agent.update({ where: { id: p.data.agentId }, data: { isDistributor: true } });
    return NextResponse.json({ ok: true });
  }

  if (action === "reset") {
    const p = resetSchema.safeParse(body);
    if (!p.success) return NextResponse.json({ error: "الباسورد ٨ أحرفٍ فأكثر" }, { status: 400 });
    const acc = await prisma.cardDistributor.findUnique({ where: { distributorAgentId: p.data.agentId }, select: { id: true } });
    if (!acc) return NextResponse.json({ error: "لا حساب" }, { status: 404 });
    await prisma.cardDistributor.update({ where: { id: acc.id }, data: { password: await hashPassword(p.data.password), plainPassword: encryptSecret(p.data.password), sessionToken: newSessionToken(), isDeleted: false } });
    return NextResponse.json({ ok: true });
  }

  if (action === "enable" || action === "disable") {
    const p = toggleSchema.safeParse(body);
    if (!p.success) return NextResponse.json({ error: "بياناتٌ غير صحيحة" }, { status: 400 });
    await prisma.agent.update({ where: { id: p.data.agentId }, data: { isDistributor: action === "enable" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "addTarget" || action === "removeTarget") {
    const p = targetSchema.safeParse(body);
    if (!p.success) return NextResponse.json({ error: "بياناتٌ غير صحيحة" }, { status: 400 });
    if (p.data.targetAgentId === p.data.agentId) return NextResponse.json({ error: "لا يضع الوكيلُ كروتاً لنفسه" }, { status: 400 });
    const acc = await prisma.cardDistributor.findUnique({ where: { distributorAgentId: p.data.agentId }, select: { id: true } });
    if (!acc) return NextResponse.json({ error: "أنشئ حسابَ الموزّع أوّلاً" }, { status: 400 });
    if (p.data.action === "addTarget") {
      const tgt = await prisma.agent.findFirst({ where: { id: p.data.targetAgentId, isDeleted: false }, select: { id: true } });
      if (!tgt) return NextResponse.json({ error: "الوكيلُ الهدفُ غير موجود" }, { status: 404 });
      const ex = await prisma.distributorTarget.findUnique({ where: { distributorId_targetAgentId: { distributorId: acc.id, targetAgentId: p.data.targetAgentId } }, select: { id: true, isDeleted: true } });
      if (ex) await prisma.distributorTarget.update({ where: { id: ex.id }, data: { isDeleted: false } });
      else await prisma.distributorTarget.create({ data: { distributorId: acc.id, targetAgentId: p.data.targetAgentId } });
    } else {
      await prisma.distributorTarget.updateMany({ where: { distributorId: acc.id, targetAgentId: p.data.targetAgentId }, data: { isDeleted: true } });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "إجراءٌ غير معروف" }, { status: 400 });
}
