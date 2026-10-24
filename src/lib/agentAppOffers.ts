import { prisma } from "@/lib/prisma";

// إنشاءٌ كسولٌ لجداول «الباقات والعروض» — النشرُ لا يشغّل migrate (نفسُ وصفة
// `ensureAgentStoreTables`): تحصينٌ للتعافي ولأوّل نشرةٍ على قاعدةٍ قائمة.
let ready = false;
export async function ensureAgentAppTables(): Promise<void> {
  if (ready) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "agent_app_packages" (
    "id" SERIAL PRIMARY KEY, "agentId" INTEGER NOT NULL, "packageId" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true, "note" TEXT, "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "agent_app_packages_agentId_packageId_key" ON "agent_app_packages" ("agentId","packageId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_app_packages_agentId_visible_idx" ON "agent_app_packages" ("agentId","visible")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "agent_offers" (
    "id" SERIAL PRIMARY KEY, "agentId" INTEGER NOT NULL, "text" TEXT, "image" TEXT,
    "targetFrom" TIMESTAMP(3), "targetTo" TIMESTAMP(3), "targetCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'visible', "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_offers_agentId_status_idx" ON "agent_offers" ("agentId","status")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "agent_offer_targets" (
    "id" SERIAL PRIMARY KEY, "offerId" INTEGER NOT NULL, "subscriberId" INTEGER NOT NULL )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "agent_offer_targets_offerId_subscriberId_key" ON "agent_offer_targets" ("offerId","subscriberId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_offer_targets_subscriberId_idx" ON "agent_offer_targets" ("subscriberId")`);
  ready = true;
}

// نافذةُ الاستهداف: مشتركو مكاتبِ الوكيل الذين ينتهي اشتراكُهم بين تاريخَين (ضمناً).
// يومُ النهاية يُؤخَذ كاملاً (حتّى 23:59:59.999) وإلّا سقط منتهو ذلك اليوم كلُّهم.
export function targetWindow(from: string, to: string): { gte: Date; lte: Date } | null {
  const a = new Date(`${from}T00:00:00.000Z`);
  const b = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || a > b) return null;
  return { gte: a, lte: b };
}

export async function targetedSubscriberIds(towerIds: number[], from: string, to: string): Promise<number[]> {
  const w = targetWindow(from, to);
  if (!w || towerIds.length === 0) return [];
  const rows = await prisma.subscriber.findMany({
    where: { isDeleted: false, purgedAt: null, towerId: { in: towerIds }, dateTo: w },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
