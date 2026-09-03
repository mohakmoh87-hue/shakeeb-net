import { prisma } from "@/lib/prisma";

// إنشاءٌ كسولٌ لجدولَي متجر الوكيل (النشرُ لا يُشغّل migrate) — تحصينٌ للتعافي.
let ready = false;
export async function ensureAgentStoreTables(): Promise<void> {
  if (ready) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "agent_products" (
    "id" SERIAL PRIMARY KEY, "agentId" INTEGER NOT NULL, "agentName" TEXT,
    "title" TEXT NOT NULL, "price" BIGINT, "description" TEXT, "photo" TEXT,
    "category" TEXT, "stock" INTEGER, "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_products_status_createdAt_idx" ON "agent_products" ("status","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_products_agentId_idx" ON "agent_products" ("agentId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "store_orders" (
    "id" SERIAL PRIMARY KEY, "agentId" INTEGER NOT NULL, "subscriberId" INTEGER NOT NULL,
    "subscriberName" TEXT, "productId" INTEGER NOT NULL, "productTitle" TEXT NOT NULL,
    "price" BIGINT, "qty" INTEGER NOT NULL DEFAULT 1, "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL, "note" TEXT, "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "store_orders_agentId_status_idx" ON "store_orders" ("agentId","status")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "store_orders_subscriberId_idx" ON "store_orders" ("subscriberId")`);
  ready = true;
}

export const STORE_ORDER_STATES = ["new", "accepted", "delivered", "declined", "cancelled"] as const;
export type StoreOrderState = (typeof STORE_ORDER_STATES)[number];
