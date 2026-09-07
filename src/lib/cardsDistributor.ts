import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCardSession, type CardSessionPayload } from "@/lib/cardAuth";
import { sendViaUltraMsg, normalizeWaBase, isSafeWaBase } from "@/lib/waChannel";

export type CardsGuard = { session: CardSessionPayload } | { error: NextResponse };
export async function cardsGuard(): Promise<CardsGuard> {
  const session = await getCardSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  return { session };
}

const WA_KEY = (distributorId: number) => `cardsWa:${distributorId}`;

export type DistWa = { enabled: boolean; baseUrl: string; instanceId: string; token: string };
export type DistWaInfo = { enabled: boolean; baseUrl: string; instanceId: string; tokenSet: boolean };

export async function getDistWa(distributorId: number): Promise<DistWa | null> {
  const row = await prisma.systemSetting.findFirst({ where: { type: WA_KEY(distributorId) }, select: { text: true } });
  if (!row?.text) return null;
  try {
    const o = JSON.parse(row.text) as Record<string, unknown>;
    return {
      enabled: o.enabled === true,
      baseUrl: normalizeWaBase(typeof o.baseUrl === "string" ? o.baseUrl : null),
      instanceId: typeof o.instanceId === "string" ? o.instanceId.trim() : "",
      token: typeof o.token === "string" ? o.token : "",
    };
  } catch {
    return null;
  }
}

export async function getDistWaInfo(distributorId: number): Promise<DistWaInfo> {
  const w = await getDistWa(distributorId);
  return { enabled: w?.enabled ?? false, baseUrl: w?.baseUrl ?? "", instanceId: w?.instanceId ?? "", tokenSet: !!(w?.token) };
}

export async function setDistWa(distributorId: number, input: { enabled?: boolean; baseUrl?: string; instanceId?: string; token?: string }): Promise<DistWaInfo> {
  const prev = await getDistWa(distributorId);
  const enabled = input.enabled ?? prev?.enabled ?? false;
  const baseUrl = normalizeWaBase(input.baseUrl ?? prev?.baseUrl);
  const instanceId = (input.instanceId ?? prev?.instanceId ?? "").trim();
  let token = prev?.token ?? "";
  if (typeof input.token === "string" && input.token.trim() !== "") token = input.token.trim();
  const text = JSON.stringify({ enabled, baseUrl, instanceId, token });
  const r = await prisma.systemSetting.findFirst({ where: { type: WA_KEY(distributorId) }, select: { id: true } });
  if (r) await prisma.systemSetting.update({ where: { id: r.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type: WA_KEY(distributorId), text } });
  return { enabled, baseUrl, instanceId, tokenSet: !!token };
}

export { isSafeWaBase };

export async function notifyTargetPhone(distributorId: number, phone: string | null | undefined, text: string): Promise<void> {
  if (!phone || !phone.trim()) return;
  const w = await getDistWa(distributorId);
  if (!w || !w.enabled || !w.instanceId || !w.token) return;
  try {
    await sendViaUltraMsg({ enabled: true, provider: "ultramsg", baseUrl: w.baseUrl, instanceId: w.instanceId, token: w.token }, phone, text);
  } catch {
    /* الإشعارُ ثانويٌّ — لا يُفشِل العمليّة */
  }
}

export async function debtFor(distributorId: number, targetAgentId: number): Promise<{ transferred: number; paid: number; remaining: number }> {
  const [tx, pay] = await Promise.all([
    prisma.distributorTransfer.aggregate({ where: { distributorId, targetAgentId }, _sum: { total: true } }),
    prisma.distributorPayment.aggregate({ where: { distributorId, targetAgentId }, _sum: { amount: true } }),
  ]);
  const transferred = tx._sum.total ?? 0;
  const paid = pay._sum.amount ?? 0;
  return { transferred, paid, remaining: transferred - paid };
}

export async function allowedTarget(distributorId: number, targetAgentId: number): Promise<boolean> {
  const t = await prisma.distributorTarget.findFirst({ where: { distributorId, targetAgentId, isDeleted: false }, select: { id: true } });
  return !!t;
}
