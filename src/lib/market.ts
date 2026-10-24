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
  // 💬 تعليقاتُ الإعلانات + عمودُ الاسم المستعار (2026-10-24) — إنشاءٌ كسولٌ كالجدول نفسِه،
  // فلا يحتاج النشرُ migrate ولا خطوةً يدويّةً على الإنتاج قبله.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "market_comments" (
    "id" SERIAL PRIMARY KEY, "listingId" INTEGER NOT NULL, "subscriberId" INTEGER NOT NULL,
    "authorName" TEXT, "text" TEXT NOT NULL, "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_comments_listingId_isDeleted_idx" ON "market_comments" ("listingId","isDeleted")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_comments_subscriberId_idx" ON "market_comments" ("subscriberId")`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "subscribers" ADD COLUMN IF NOT EXISTS "appNickname" TEXT`);
  ready = true;
}

// الاسمُ المعروضُ للمشترك في سوق المستعمل: المستعارُ إن وضعه، وإلّا اسمُه، وإلّا اللقطةُ
// المخزَّنة. مصدرٌ واحدٌ لكلّ موضعٍ يعرض اسمَ مشتركٍ فلا يختلف إعلانٌ عن تعليق.
export function displayName(
  sub: { appNickname?: string | null; name?: string | null } | null | undefined,
  snapshot?: string | null,
): string {
  const nick = (sub?.appNickname ?? "").trim();
  if (nick) return nick;
  const real = (sub?.name ?? "").trim();
  if (real) return real;
  return (snapshot ?? "").trim() || "مشترك";
}

export const MAX_COMMENT = 300;

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
