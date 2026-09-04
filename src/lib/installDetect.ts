import { prisma } from "@/lib/prisma";
import { pkgWordKey } from "@/lib/packageMatch";

// ═════ كشفُ التنصيبات لأرباح الشركة (طلبُ محمد 2026-09-04) ═════
// المشكلة: التنصيبُ داخل المكتب يُنشئ مشتركاً + وصلاً عندنا ⇒ يُطابَق في المزامنة ⇒ **لا يُنشَأ صفُّ
// `install`** (يُنشَأ فقط ليوزرِ ساسٍ غيرِ موجود = خارجيّ) ⇒ محرّكُ الأرباح لا يراه فيبقى صفراً.
// الحلّ: هذا الكشفُ يُنشئ صفَّ `install` (بمشتركٍ + وقتِ الوصل) للتنصيب الداخليّ، ومحرّكُ الأرباح
// يصنّفه ديناميكيّاً: له وصلٌ ⇒ داخليّ · بلا وصل ⇒ خارجيّ (فالمراقبةُ ±٢ تلقائيّةٌ لحظةَ العرض).
//
// «العرض» (تعريفُ محمد): **اسمُ باقة الساس الخام ليس من باقاتك المُضافة** (باقاتُك «Hero-…»،
// والترويجيّةُ «Offer-…(60 Days)» = عرض). نقيسه بمفتاح الاسم (pkgWordKey) لا بمفتاح السرعة الذي
// يربط Offer↔Hero للسعر. و«تنصيبٌ جديد» (لا تجديد): أوّلُ وصلٍ للمشترك، أو فجوةُ انتهاءٍ سابقةٌ > شهر.

export type DetectedInstall = {
  subscriberId: number; towerId: number; sasId: number | null; netUser: string | null; name: string | null;
  packageName: string; at: Date; brandNew: boolean;
};

// يبني مجموعةَ مفاتيح أسماء باقات الوكيل (لتمييز «العرض» = ما ليس منها)
async function agentPkgKeys(agentId: number): Promise<Set<string>> {
  const pkgs = await prisma.package.findMany({ where: { agentId, isDeleted: false }, select: { name: true } });
  const s = new Set<string>();
  for (const p of pkgs) { const k = pkgWordKey(p.name); if (k) s.add(k); }
  return s;
}

// عرض؟ = اسمٌ خامٌّ له مفتاحٌ لا يطابق أيَّ باقةٍ للوكيل
function isOfferName(raw: string | null | undefined, heroKeys: Set<string>): boolean {
  const k = pkgWordKey(raw);
  return !!k && !heroKeys.has(k);
}

// يكشف التنصيبات الداخليّة (مشتركٌ مطابَقٌ + وصلٌ جديد + باقةُ عرض) للأبراج المعطاة منذ sinceMs،
// ويُنشئ لها صفَّ `install` (مرّةً لكلّ مشترك) ما لم يوجد. dryRun ⇒ لا كتابة (يُرجع القائمة فقط).
export async function detectInternalInstalls(
  agentId: number, towerIds: number[], sinceMs: number, opts: { dryRun?: boolean } = {},
): Promise<DetectedInstall[]> {
  if (!towerIds.length) return [];
  const heroKeys = await agentPkgKeys(agentId);
  const since = new Date(sinceMs);
  // أوّلُ وصلٍ للمشترك أو فجوةُ انتهاءٍ سابقةٌ > شهر (تنصيبٌ جديدٌ لا تجديد) — مع اسم باقة الساس الخام.
  const rows = await prisma.$queryRaw<Array<{
    subscriberId: number; date: Date; packageName: string | null; towerId: number; sasId: number | null;
    netUser: string | null; name: string | null; rn: number; prevTo: Date | null;
  }>>`
    WITH ent AS (
      SELECT e."subscriberId", e.date, e."dateTo",
             LAG(e."dateTo") OVER (PARTITION BY e."subscriberId" ORDER BY e.date) AS "prevTo",
             ROW_NUMBER() OVER (PARTITION BY e."subscriberId" ORDER BY e.date) AS rn
      FROM subscription_entries e WHERE e."isDeleted" = false
    ),
    sas AS (
      SELECT DISTINCT ON (sl."subscriberId") sl."subscriberId", sl."packageName"
      FROM sync_log sl WHERE sl."packageName" IS NOT NULL AND sl."subscriberId" IS NOT NULL
      ORDER BY sl."subscriberId", sl."createdAt" DESC
    )
    SELECT en."subscriberId", en.date, sas."packageName", s."towerId", s."sasId", s."netUser", s.name,
           en.rn::int AS rn, en."prevTo"
    FROM ent en
    JOIN sas ON sas."subscriberId" = en."subscriberId"
    JOIN subscribers s ON s.id = en."subscriberId"
    WHERE s."isDeleted" = false AND s."towerId" = ANY(${towerIds})
      AND en.date >= ${since}
      AND (en.rn = 1 OR (en."prevTo" IS NOT NULL AND en.date - en."prevTo" > interval '30 days'))
    ORDER BY en."subscriberId", en.date DESC
  `;
  const out: DetectedInstall[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.subscriberId)) continue;
    if (!isOfferName(r.packageName, heroKeys)) continue; // ليست عرضاً ⇒ تجاهُل
    seen.add(r.subscriberId);
    out.push({
      subscriberId: r.subscriberId, towerId: r.towerId, sasId: r.sasId, netUser: r.netUser, name: r.name,
      packageName: r.packageName!, at: r.date, brandNew: r.rn === 1,
    });
  }
  if (!opts.dryRun && out.length) await writeInstalls(agentId, out);
  return out;
}

// يُنشئ صفَّ `install` للتنصيب الداخليّ (مرّةً لكلّ مشترك) — لا يمسّ إن وُجد صفٌّ سلفاً.
async function writeInstalls(agentId: number, installs: DetectedInstall[]): Promise<void> {
  for (const it of installs) {
    try {
      const exists = await prisma.syncLog.findFirst({
        where: { kind: "install", subscriberId: it.subscriberId }, select: { id: true },
      });
      if (exists) continue; // مرصودٌ سلفاً
      await prisma.syncLog.create({
        data: {
          agentId, towerId: it.towerId, kind: "install", subscriberId: it.subscriberId, sasId: it.sasId,
          netUser: it.netUser, name: it.name, packageName: it.packageName, activatedAt: it.at,
          // done مباشرةً: صفٌّ معلوماتيٌّ للأرباح (لا إجراءَ يدويٌّ عليه) فلا يظهر في تبويب تنصيبات سجلّ المزامنة
          status: "done", handledBy: "النظام", handledAt: new Date(),
          note: "تنصيبٌ داخليٌّ مكتشَفٌ من الوصل (كشفُ التنصيبات)",
        },
      });
    } catch { /* لا يُفشل المزامنة/الباك-فيل */ }
  }
}

// باك-فيل: يكشف تنصيبات وكيلٍ منذ تاريخٍ (يوم ١ من الشهر) لكلّ أبراجه.
export async function backfillAgentInstalls(agentId: number, sinceMs: number, dryRun = false): Promise<DetectedInstall[]> {
  const towers = await prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } });
  return detectInternalInstalls(agentId, towers.map((t) => t.id), sinceMs, { dryRun });
}
