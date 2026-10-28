import { prisma } from "@/lib/prisma";

// إنشاءٌ كسولٌ لجدول سوق المستعمل (النشرُ لا يُشغّل migrate) — تحصينٌ للتعافي.
// 🛡️ محاولةٌ واحدةٌ مبتلَعةُ الفشل: الـDDL يشترط ملكيّةَ الجدول، وحاسبةُ المكتب تُشغّل
//    نفسَ الموقع بدورٍ غيرِ مالك ⇒ لا تُسقط صفحةً بسبب عمودٍ منشأٍ أصلاً من الموقع.
let ready = false;
let tried = false;
export async function ensureMarketTable(): Promise<void> {
  if (ready || tried) return;
  tried = true;
  try {
    await ensureMarketDdl();
    ready = true;
  } catch { /* بلا ملكيّةٍ — الجداولُ منشأةٌ من الموقع */ }
}

async function ensureMarketDdl(): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "market_listings" (
    "id" SERIAL PRIMARY KEY, "sellerId" INTEGER NOT NULL, "sellerName" TEXT,
    "title" TEXT NOT NULL, "price" BIGINT, "description" TEXT, "phone" TEXT NOT NULL,
    "photo" TEXT, "category" TEXT, "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_listings_status_createdAt_idx" ON "market_listings" ("status","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_listings_sellerId_idx" ON "market_listings" ("sellerId")`);
  // 💬 تعليقاتُ الإعلانات (2026-10-24) — إنشاءٌ كسولٌ كالجدول نفسِه، فلا يحتاج النشرُ migrate.
  // ⚠️ وعمودُ `subscribers.appNickname` **لا يُضاف هنا**: عمودٌ على جدولٍ قائمٍ يُدرجه
  //    Prisma في كلّ استعلامٍ بلا select فينهار كلُّ مسارٍ يقرؤه قبل أن يمرّ أحدٌ بهذا
  //    الإنشاء — وهو ما كسر تفعيلَ المشتركين يوم أُضيف. يُنفَّذ ALTER على الإنتاج أوّلاً
  //    ثمّ يُنشَر الكود (حارسُ tests/lazy-ddl-safety).
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "market_comments" (
    "id" SERIAL PRIMARY KEY, "listingId" INTEGER NOT NULL, "subscriberId" INTEGER NOT NULL,
    "authorName" TEXT, "text" TEXT NOT NULL, "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_comments_listingId_isDeleted_idx" ON "market_comments" ("listingId","isDeleted")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_comments_subscriberId_idx" ON "market_comments" ("subscriberId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "app_popups" (
    "id" SERIAL PRIMARY KEY, "text" TEXT, "image" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'all', "sort" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'visible', "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "app_popups_status_sort_idx" ON "app_popups" ("status","isDeleted","sort")`);
  // عمودُ النوع على جدولٍ **من جداولي** لا جدولٍ مركزيّ — فالكسولُ مسموحٌ هنا
  // (حارسُ lazy-ddl يحصر المنعَ بالجداول المركزيّة).
  await prisma.$executeRawUnsafe(`ALTER TABLE "app_popups" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'popup'`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "app_accounts" (
    "id" SERIAL PRIMARY KEY, "phoneCore" TEXT NOT NULL, "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL, "area" TEXT NOT NULL,
    "isBanned" BOOLEAN NOT NULL DEFAULT false, "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "app_accounts_phoneCore_key" ON "app_accounts" ("phoneCore")`);
  // 👤 الاسمُ المستعار وكلمةُ المرور لحساب غير المشترك (طلبُ محمد 2026-10-28)
  await prisma.$executeRawUnsafe(`ALTER TABLE "app_accounts" ADD COLUMN IF NOT EXISTS "nickname" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "app_accounts" ADD COLUMN IF NOT EXISTS "passHash" TEXT`);
  // 🖼️ صورتُه الشخصيّة — يظهر بها في سوق المستعمل كالمشترك (طلبُ محمد 2026-10-28)
  await prisma.$executeRawUnsafe(`ALTER TABLE "app_accounts" ADD COLUMN IF NOT EXISTS "photo" TEXT`);
  // 🖼️ صورُ الإعلان الإضافيّة (حتّى ٥ — طلبُ محمد 2026-10-26) في **جدولٍ منفصل**
  //    لا في أعمدةٍ على `market_listings`: فاستعلاماتُ لوحة الإدارة تقرأ الصفَّ بلا
  //    `select`، وخمسُ صورٍ في الصفّ تُثقِل كلَّ قراءةٍ للسوق. الغلافُ يبقى في
  //    `photo` كما كان فلا يتغيّر شيءٌ لإعلانٍ قديم.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "market_photos" (
    "id" SERIAL PRIMARY KEY, "listingId" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0, "image" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "market_photos_listingId_sort_idx" ON "market_photos" ("listingId","sort")`);
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

// أسماءٌ أنثويّةٌ قاطعةٌ شائعةٌ في العراق + لواحقُ لا تلتبس. والملتبسُ يأخذ أيقونةً
// محايدةً عمداً: تخمينُ جنسِ إنسانٍ خطأً أسوأُ من أيقونةٍ عامّة (لا حقلَ جنسٍ في القاعدة).
const FEMALE = new Set(["فاطمة","زهراء","زينب","رقية","مريم","سارة","نور","هدى","رنا","دعاء","شهد","آية","إسراء","اسراء","بتول","تبارك","حوراء","سجى","غفران","مروة","منار","ميساء","نرجس","هبة","وفاء","ايمان","إيمان","امل","أمل","سناء","رحمة","زهرة","بشرى","صابرين","سحر","عبير","لمى","ليلى","نجلاء","هناء"]);
export function defaultAvatar(name: string | null | undefined): "f" | "m" | "n" {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "n";
  if (FEMALE.has(first)) return "f";
  if (/^(أم|ام)$/.test(first)) return "f";
  if (/^(أبو|ابو)$/.test(first)) return "m";
  return "n";
}

// 🪪 هويّةُ مشتركٍ كما تُعرَض: الاسمُ العامُّ للجميع، والحقيقيُّ لأدمن التطبيق وحدَه.
// 🔒 `isAdmin` يأتي من كوكي الأدمن في الخادم — لا من علَمٍ يرسله العميل أبداً.
export function identityOf(
  sub: { appNickname?: string | null; name?: string | null; netUser?: string | null; appPhoto?: string | null } | null | undefined,
  snapshot: string | null | undefined,
  isAdmin: boolean,
): { sellerName: string; sellerPhoto: string | null; avatar: "f" | "m" | "n"; realName?: string; netUser?: string } {
  // ⚠️ `sellerPhoto` لا `photo`: صفُّ الإعلان فيه `photo` (صورةُ السلعة)، ونشرُ هذه
  //    فوقه كان يطمسها. اسمان متمايزان يقطعان الالتباسَ عند أيّ دمجٍ لاحق.
  const pub = publicIdentity(sub, snapshot);
  const base = { sellerName: pub.name, sellerPhoto: pub.photo, avatar: pub.avatar };
  if (!isAdmin) return base;
  return {
    ...base,
    realName: (sub?.name ?? "").trim() || pub.name,
    netUser: (sub?.netUser ?? "").trim(),
  };
}
// 🪪 هويّةُ مشتركٍ كما تُعرَض: الاسمُ العامُّ للجميع، والحقيقيُّ لأدمن التطبيق وحدَه.
export type PublicIdentity = { name: string; photo: string | null; avatar: "f" | "m" | "n" };
export function publicIdentity(
  sub: { appNickname?: string | null; name?: string | null; appPhoto?: string | null } | null | undefined,
  snapshot?: string | null,
): PublicIdentity {
  return {
    name: displayName(sub, snapshot),
    photo: sub?.appPhoto ?? null,
    avatar: defaultAvatar(sub?.name),
  };
}

export const MAX_MARKET_IMG = 400_000; // سقفُ صورة الإعلان
// صورةٌ نقطيّةٌ حصراً (png/jpg/webp/gif) — تُرفَض svg (قد تحمل سكربتاً) وأيُّ data:text/*.
export function cleanPhoto(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX_MARKET_IMG) return null;
  return /^data:image\/(png|jpe?g|webp|gif);/i.test(v) ? v : null;
}
// 🖼️ حتّى خمسُ صورٍ للإعلان (طلبُ محمد 2026-10-26) — أوّلُها الغلاف.
export const MAX_PHOTOS = 5;
export function cleanPhotos(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const ok = cleanPhoto(x);
    if (ok) out.push(ok);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

// price في القاعدة BigInt؛ يُحوَّل Number للاستجابة (الأسعارُ الواقعيّة < 2^53 فلا فقدَ دقّة).
export function priceToNum(p: bigint | null | undefined): number | null {
  return p == null ? null : Number(p);
}
