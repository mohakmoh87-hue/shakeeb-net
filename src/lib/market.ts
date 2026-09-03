import { prisma } from "@/lib/prisma";

// إنشاءٌ كسولٌ لجدول سوق المستعمل (النشرُ لا يُشغّل migrate) — تحصينٌ للتعافي.
let ready = false;
export async function ensureMarketTable(): Promise<void> {
  if (ready) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "market_listings" (
    "id" SERIAL PRIMARY KEY, "sellerId" INTEGER NOT NULL, "sellerName" TEXT,
    "title" TEXT NOT NULL, "price" BIGINT, "description" TEXT, "phone" TEXT NOT NULL,
    "photo" TEXT, "category" TEXT, "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_listings_status_createdAt_idx" ON "market_listings" ("status","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_listings_sellerId_idx" ON "market_listings" ("sellerId")`);
  ready = true;
}

export const MAX_MARKET_IMG = 400_000; // سقفُ صورة الإعلان
// صورةٌ نقطيّةٌ حصراً (png/jpg/webp/gif) — تُرفَض svg (قد تحمل سكربتاً) وأيُّ data:text/*.
export function cleanPhoto(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX_MARKET_IMG) return null;
  return /^data:image\/(png|jpe?g|webp|gif);/i.test(v) ? v : null;
}
// price في القاعدة BigInt؛ يُحوَّل Number للاستجابة (الأسعارُ الواقعيّة < 2^53 فلا فقدَ دقّة).
export function priceToNum(p: bigint | null | undefined): number | null {
  return p == null ? null : Number(p);
}
