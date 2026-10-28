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
  // جمهورُ العرض (2026-10-27) — عمودٌ على جدولٍ **غيرِ مركزيٍّ** يُنشأ هنا، وهذه
  // الدالّةُ تُنادى في كلّ مسارٍ يقرأ `agent_offers` **قبل** أوّل استعلامٍ فيه،
  // فلا تتكرّر حادثةُ `subscribers.appNickname` (Prisma يطلب كلَّ عمودٍ بلا select).
  await prisma.$executeRawUnsafe(`ALTER TABLE "agent_offers" ADD COLUMN IF NOT EXISTS "audience" TEXT NOT NULL DEFAULT 'subs'`);
  // ترشيحُ الباقة (2026-10-28) — قائمةُ معرّفاتٍ بفواصل، والفارغُ = كلُّ الباقات
  await prisma.$executeRawUnsafe(`ALTER TABLE "agent_offers" ADD COLUMN IF NOT EXISTS "packages" TEXT`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "agent_offer_targets" (
    "id" SERIAL PRIMARY KEY, "offerId" INTEGER NOT NULL, "subscriberId" INTEGER NOT NULL )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "agent_offer_targets_offerId_subscriberId_key" ON "agent_offer_targets" ("offerId","subscriberId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_offer_targets_subscriberId_idx" ON "agent_offer_targets" ("subscriberId")`);
  ready = true;
}

// ═════ 🎯 جمهورُ العرض (طلبُ محمد 2026-10-28) ═════
// يُخزَّن قائمةً بفواصل من الأصناف الأربعة. والقيمُ الثلاثُ القديمةُ تُوسَّع عند القراءة
// **بما يطابق سلوكَ الأمس حرفاً بحرف** — فلا يتغيّر عرضٌ أُرسل قبل اليوم:
//   subs   ⇒ المشتركُ الفعّال وحدَه (ومعه مجموعتُه المثبَّتة)
//   guests ⇒ المنتهي الطويلُ وغيرُ المشترك والزائر
//   all    ⇒ الأربعةُ جميعاً
export const APP_CLASSES = ["sub_active", "sub_expired", "account", "guest"] as const;
export type OfferClass = (typeof APP_CLASSES)[number];
const LEGACY: Record<string, OfferClass[]> = {
  subs: ["sub_active"],
  guests: ["sub_expired", "account", "guest"],
  all: ["sub_active", "sub_expired", "account", "guest"],
};

export function offerClasses(audience: string | null | undefined): OfferClass[] {
  const raw = (audience ?? "").trim();
  if (!raw) return LEGACY.subs;
  if (LEGACY[raw]) return LEGACY[raw];
  const set = new Set(raw.split(",").map((s) => s.trim()));
  return APP_CLASSES.filter((c) => set.has(c));
}

export function cleanClasses(v: unknown): string {
  const arr = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : [];
  const set = new Set(arr.map((s) => s.trim()));
  const picked = APP_CLASSES.filter((c) => set.has(c));
  return picked.join(",");
}

export function cleanPackageIds(v: unknown): string | null {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const ids = [...new Set(arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
  return ids.length ? ids.join(",") : null;
}

export function packageIdsOf(packages: string | null | undefined): number[] {
  return (packages ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

/** هل يرى هذا الصنفُ (وهذه الباقةُ) هذا العرضَ؟
 *  ⚠️ وترشيحُ الباقة يُطبَّق على **المشتركين وحدَهم**: الزائرُ لا باقةَ له، فلو طُبِّق عليه
 *  لاختفى عنه عرضٌ اختار صاحبُه أن يراه. */
export function offerVisibleTo(
  offer: { audience: string | null; packages: string | null },
  klass: OfferClass,
  packageId: number | null,
): boolean {
  if (!offerClasses(offer.audience).includes(klass)) return false;
  const pkgs = packageIdsOf(offer.packages);
  if (!pkgs.length) return true;
  const isSub = klass === "sub_active" || klass === "sub_expired";
  if (!isSub) return true;
  return packageId != null && pkgs.includes(packageId);
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
