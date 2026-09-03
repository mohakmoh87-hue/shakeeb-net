import { prisma } from "@/lib/prisma";
import { priceToNum } from "@/lib/market";

// إنشاءٌ كسولٌ لجدولَي متجر الوكيل + أعمدةٍ إضافيّة (النشرُ لا يُشغّل migrate) — تحصينٌ للتعافي.
let ready = false;
export async function ensureAgentStoreTables(): Promise<void> {
  if (ready) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "agent_products" (
    "id" SERIAL PRIMARY KEY, "agentId" INTEGER NOT NULL, "agentName" TEXT,
    "title" TEXT NOT NULL, "price" BIGINT, "description" TEXT, "photo" TEXT,
    "category" TEXT, "stock" INTEGER, "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "agent_products" ADD COLUMN IF NOT EXISTS "itemName" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "agent_products" ADD COLUMN IF NOT EXISTS "deliveryFee" BIGINT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "agent_products" ADD COLUMN IF NOT EXISTS "installFee" BIGINT`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_products_status_createdAt_idx" ON "agent_products" ("status","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_products_agentId_idx" ON "agent_products" ("agentId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "store_orders" (
    "id" SERIAL PRIMARY KEY, "agentId" INTEGER NOT NULL, "subscriberId" INTEGER NOT NULL,
    "subscriberName" TEXT, "productId" INTEGER NOT NULL, "productTitle" TEXT NOT NULL,
    "price" BIGINT, "qty" INTEGER NOT NULL DEFAULT 1, "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL, "note" TEXT, "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "fulfillment" TEXT NOT NULL DEFAULT 'delivery'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "deliveryFee" BIGINT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "installFee" BIGINT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "total" BIGINT`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "store_orders_agentId_status_idx" ON "store_orders" ("agentId","status")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "store_orders_subscriberId_idx" ON "store_orders" ("subscriberId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "store_order_items" (
    "id" SERIAL PRIMARY KEY, "orderId" INTEGER NOT NULL, "productId" INTEGER NOT NULL,
    "productTitle" TEXT NOT NULL, "price" BIGINT, "qty" INTEGER NOT NULL DEFAULT 1 )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "store_order_items_orderId_idx" ON "store_order_items" ("orderId")`);
  ready = true;
}

export const STORE_ORDER_STATES = ["new", "accepted", "delivered", "declined", "cancelled"] as const;
export type StoreOrderState = (typeof STORE_ORDER_STATES)[number];
export const STORE_FULFILLMENTS = ["delivery", "delivery_install"] as const;

// العددُ الحيُّ للمنتجات المربوطة بالمخزن: مجموعُ عدد الصنف (بالاسم) في كلّ مكاتب وكيله.
// استعلاماتٌ ثابتةٌ العدد (مكاتب + أصناف) لا N+1. المنتجُ الحرُّ (itemName فارغ) لا يُدرَج.
export async function liveStockFor(
  products: { id: number; agentId: number; itemName: string | null }[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const linked = products.filter((p) => p.itemName && p.itemName.trim()).map((p) => ({ ...p, itemName: p.itemName!.trim() }));
  if (linked.length === 0) return result;
  const agentIds = [...new Set(linked.map((p) => p.agentId))];
  // نفسُ مجموعة المكاتب التي يستقي منها المنتقي (مكاتبُ الوكيل غيرُ المحذوفة)
  const towers = await prisma.tower.findMany({ where: { agentId: { in: agentIds }, isDeleted: false }, select: { id: true, agentId: true } });
  const agentTowers = new Map<number, number[]>();
  for (const t of towers) {
    if (t.agentId == null) continue;
    const arr = agentTowers.get(t.agentId) ?? [];
    arr.push(t.id);
    agentTowers.set(t.agentId, arr);
  }
  const allTowerIds = towers.map((t) => t.id);
  if (allTowerIds.length === 0) return result;
  const items = await prisma.item.findMany({
    where: { isDeleted: false, towerId: { in: allTowerIds } },
    select: { name: true, count: true, towerId: true },
  });
  for (const p of linked) {
    const tids = agentTowers.get(p.agentId) ?? [];
    let sum = 0;
    for (const it of items) {
      if (it.towerId != null && tids.includes(it.towerId) && (it.name ?? "").trim() === p.itemName) sum += it.count ?? 0;
    }
    result.set(p.id, Math.round(sum));
  }
  return result;
}

// بنودُ الطلبات (سلّة) مفهرسةً بـorderId — مع ارتدادٍ للطلبات المفردة القديمة (تُشتَقُّ من الرأس).
export async function storeOrderLines(
  orders: { id: number; productTitle: string; price: bigint | null; qty: number }[],
): Promise<Map<number, { productTitle: string; price: number | null; qty: number }[]>> {
  const m = new Map<number, { productTitle: string; price: number | null; qty: number }[]>();
  const ids = orders.map((o) => o.id);
  const rows = ids.length ? await prisma.storeOrderItem.findMany({ where: { orderId: { in: ids } }, orderBy: { id: "asc" } }) : [];
  for (const l of rows) {
    const arr = m.get(l.orderId) ?? [];
    arr.push({ productTitle: l.productTitle, price: priceToNum(l.price), qty: l.qty });
    m.set(l.orderId, arr);
  }
  for (const o of orders) if (!m.has(o.id)) m.set(o.id, [{ productTitle: o.productTitle, price: priceToNum(o.price), qty: o.qty }]);
  return m;
}

// وكيلُ المشترك (لتحديد الشريحة): Subscriber.towerId ⇒ Tower.agentId.
export async function subscriberAgentId(subscriberId: number): Promise<number | null> {
  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { towerId: true } });
  if (!sub?.towerId) return null;
  const t = await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { agentId: true } });
  return t?.agentId ?? null;
}

// رسومُ التوصيل/التنصيب لكلّ منتجٍ حسب شريحة المشترِي: مشتركُ الوكيلِ البائع ⇒ رسومُ المشتركين، وإلّا غيرُهم.
export async function feesForProducts(
  products: { id: number; agentId: number }[],
  viewerAgentId: number | null,
): Promise<Map<number, { deliveryFee: number | null; installFee: number | null }>> {
  const result = new Map<number, { deliveryFee: number | null; installFee: number | null }>();
  if (products.length === 0) return result;
  const agentIds = [...new Set(products.map((p) => p.agentId))];
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, storeDeliverySub: true, storeInstallSub: true, storeDeliveryOther: true, storeInstallOther: true },
  });
  const byAgent = new Map(agents.map((a) => [a.id, a]));
  for (const p of products) {
    const a = byAgent.get(p.agentId);
    const isSub = viewerAgentId != null && viewerAgentId === p.agentId;
    result.set(p.id, {
      deliveryFee: priceToNum((isSub ? a?.storeDeliverySub : a?.storeDeliveryOther) ?? null),
      installFee: priceToNum((isSub ? a?.storeInstallSub : a?.storeInstallOther) ?? null),
    });
  }
  return result;
}
