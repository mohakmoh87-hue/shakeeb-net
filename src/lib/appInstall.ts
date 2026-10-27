import { prisma } from "@/lib/prisma";

// ═════ 📲 تنصيبُ التطبيق: تمييزُ المشترك ونقاطُ الفنيّ — طلبُ محمد 2026-10-27 ═════
//
// القاعدةُ كما أملاها:
//  ١. المشتركُ المنصِّبُ للبرنامج **والمسجّلُ دخولَه** يُظلَّل بشريطٍ سماويٍّ في جدول
//     المشتركين على طول الصفّ.
//  ٢. عند إنجاز **أيّ** بطاقةٍ له: إن كان منصِّباً ⇒ نقاطٌ لفنيّ البطاقة بالمقدار الذي
//     يحدّده المدير، ويُختَم المشتركُ «نِيل الجائزة» فلا تُمنَح مرّتَين — **لأوّلِ تنصيبٍ
//     فقط**.
//  ٣. من نصّب بنفسه بلا بطاقةٍ قائمةٍ ⇒ يدخل الجدولَ ولا نقاطَ لأحد.
//  ٤. من كان منصِّباً **قبل الإنجاز بأربعٍ وعشرين ساعةً أو أكثر** ⇒ لا نقاطَ.
//
// وقراراه عند السؤال:
//  • النافذةُ **من الجهتَين ±٢٤ ساعة**: الفنيُّ غالباً يُغلق البطاقةَ ثمّ يسجّل المشتركُ
//    دخولَه — فلو فُحِص لحظةَ الإنجاز وحدَها ضاعت نقاطُه. ولذلك تُنادى `maybeAward`
//    **من مكانَين**: لحظةَ الإنجاز ولحظةَ أوّلِ دخول.
//  • و**تُشترط بطاقةٌ قائمةٌ قبل الدخول** (`card.createdAt <= firstLoginAt`) — وهو نصُّ
//    قاعدته الثالثة: من نصّب بنفسه لا يُهدي نقاطاً لأوّلِ فنيٍّ يُغلق له صيانةً بعدها.
//  • ومن دخل التطبيقَ **قبل** هذه الميزة يُسجَّل منصِّباً بختم `legacy` ⇒ شريطٌ سماويٌّ
//    بلا جائزةٍ أبداً، فلا يأخذ فنيٌّ نقاطَ تنصيبٍ لم يعمله.
//
// 🔒 العزلُ بالمعرّفات: الوكيلُ من مكتب المشترك، والبطاقاتُ المرشَّحةُ مقصورةٌ على
//    **فنيّي ذلك الوكيل** (`technicianId IN ...`) — لا بنصٍّ ولا باسم.
// 🔑 والمنحُ بـ`updateMany({ awarded: false })` فالنداءُ مرّتَين لا يمنح مرّتَين (درسُ
//    حارس التنفيذ المزدوج).

export const APP_INSTALL_WINDOW_MS = 24 * 60 * 60 * 1000;

// جدولانِ جديدانِ يُنشآن كسولاً — غيرُ مركزيَّين، ويُنادى `ensure` قبل أوّلِ استعلامٍ
// عليهما في كلّ مسار (درسُ `subscribers.appNickname`: Prisma يطلب كلَّ عمودٍ بلا select).
//
// 🔴 **وحاسبةُ المكتب تُشغّل نفسَ الموقع** بدور `agent_N_worker` **بلا أيّ صلاحيّةِ DDL**
//    (رابطُها `agents."workerDbUrl"`). فلو رُمي خطأُ الإنشاء هناك لانكسرت صفحاتٌ قائمةٌ
//    لا علاقةَ لها بالميزة (أنواعُ البطاقات · الإنجازات · المشتركون). ولذلك:
//    • الإنشاءُ يُحاوَل **مرّةً واحدةً** ويُبتلَع فشلُه (الموقعُ أنشأ الجدولَين أصلاً).
//    • وكلُّ قراءةٍ هنا تتحمّل غيابَ الجدول/الإذن فتُرجِع قيمةً محيّدة.
//    • والعاملُ له `SELECT/UPDATE` في `02-grants.sql` ⇒ الشريطُ والنقاطُ والجائزةُ تعمل
//      على حاسبة المكتب أيضاً، فلا ميزةٌ نصفُ ميّتةٍ بصمت («كتابةٌ/قراءةٌ جديدة = GRANT»).
let ready = false;
let tried = false;
export async function ensureAppInstallTables(): Promise<void> {
  if (ready || tried) return;
  tried = true;
  try {
    await ensureDdl();
    ready = true;
  } catch { /* حاسبةُ مكتبٍ بلا DDL — الجدولانِ منشأانِ من الموقع */ }
}

async function ensureDdl(): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "subscriber_app_installs" (
    "id" SERIAL PRIMARY KEY,
    "agentId" INTEGER, "subscriberId" INTEGER NOT NULL, "towerId" INTEGER,
    "firstLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "awarded" BOOLEAN NOT NULL DEFAULT false,
    "awardedAt" TIMESTAMP(3), "technicianId" INTEGER, "cardId" INTEGER,
    "points" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_app_installs_subscriberId_key" ON "subscriber_app_installs" ("subscriberId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "subscriber_app_installs_agentId_idx" ON "subscriber_app_installs" ("agentId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "subscriber_app_installs_awarded_awardedAt_idx" ON "subscriber_app_installs" ("awarded","awardedAt")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "agent_points_settings" (
    "id" SERIAL PRIMARY KEY, "agentId" INTEGER NOT NULL,
    "appInstallPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "agent_points_settings_agentId_key" ON "agent_points_settings" ("agentId")`);
  // ختمُ «قديم» لمن دخل التطبيقَ قبل الميزة — `lastAppLoginAt` آخرُ دخولٍ لا أوّلُه،
  // فلا سبيلَ لمعرفة زمن تنصيبهم ⇒ شريطٌ سماويٌّ بلا جائزة (قرارُ محمد).
  // ويُعاد تنفيذُها بلا أثرٍ: `ON CONFLICT DO NOTHING` يتجاوز كلَّ صفٍّ موجود.
  await prisma.$executeRawUnsafe(`INSERT INTO "subscriber_app_installs" ("agentId","subscriberId","towerId","firstLoginAt","legacy")
    SELECT t."agentId", s.id, s."towerId", s."lastAppLoginAt", true
    FROM subscribers s LEFT JOIN towers t ON t.id = s."towerId"
    WHERE s."isDeleted" = false AND s."purgedAt" IS NULL AND s."lastAppLoginAt" IS NOT NULL
    ON CONFLICT ("subscriberId") DO NOTHING`);
}

/** نقاطُ تنصيب التطبيق كما ضبطها مديرُ الوكيل — صفرٌ = الميزةُ بلا نقاطٍ عنده. */
export async function agentAppInstallPoints(agentId: number | null): Promise<number> {
  if (agentId == null) return 0;
  await ensureAppInstallTables();
  try {
    const row = await prisma.agentPointsSettings.findUnique({ where: { agentId }, select: { appInstallPoints: true } });
    return row?.appInstallPoints ?? 0;
  } catch { return 0; } // لا جدولَ/إذن ⇒ بلا نقاطٍ، ولا تنكسر الصفحةُ التي استدعتها
}

export async function setAgentAppInstallPoints(agentId: number, points: number): Promise<number> {
  await ensureAppInstallTables();
  const v = Number.isFinite(points) && points >= 0 ? points : 0;
  const row = await prisma.agentPointsSettings.upsert({
    where: { agentId },
    update: { appInstallPoints: v },
    create: { agentId, appInstallPoints: v },
    select: { appInstallPoints: true },
  });
  return row.appInstallPoints;
}

/** أوّلُ دخولٍ للمشترك ⇒ صفٌّ في جدول المنصِّبين. والدخولُ التالي لا يحرّك `firstLoginAt`. */
export async function recordAppInstall(subscriberId: number): Promise<void> {
  await ensureAppInstallTables();
  // (الدخولُ لا يجري إلّا على الموقع العامّ، فالإنشاءُ هنا مضمون)
  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { towerId: true } });
  const towerId = sub?.towerId ?? null;
  const agentId = towerId != null
    ? (await prisma.tower.findUnique({ where: { id: towerId }, select: { agentId: true } }))?.agentId ?? null
    : null;
  await prisma.subscriberAppInstall.createMany({
    data: [{ agentId, subscriberId, towerId, firstLoginAt: new Date(), legacy: false }],
    skipDuplicates: true,
  });
}

type CardLite = { id: number; title: string; description: string | null; subscriberId: number | null; technicianId: number | null; createdAt: Date };

/** بطاقةٌ لهذا المشترك؟ بالمعرّف إن حملته، وإلّا بذكرِ يوزرِه كلمةً كاملةً في نصّها —
 *  وهي نفسُ وصفةِ `matchSubscriber` في مسار الإنجاز معكوسةً (بطاقاتُ اللوحة اليدويّة
 *  تُنشأ بلا `subscriberId` أصلاً). وبطاقةٌ تحمل معرّفَ مشتركٍ آخرَ تُرفَض ولا يُجرَّب
 *  نصُّها — فالمعرّفُ أقوى من النصّ دائماً. */
export function cardMatchesSubscriber(c: CardLite, subscriberId: number, netUser: string | null): boolean {
  if (c.subscriberId != null) return c.subscriberId === subscriberId;
  const u = (netUser ?? "").trim().toLowerCase();
  if (u.length < 3) return false;
  const text = `${c.title}\n${c.description ?? ""}`.toLowerCase();
  return text.split(/[\s،,\n]+/).some((w) => w.trim() === u);
}

/** يُنادى لحظةَ إنجاز بطاقةٍ **ولحظةَ أوّلِ دخول** — وأيُّهما وقع ثانياً يمنح النقاط.
 *  أفضلُ جهدٍ: لا يُفشل الإنجازَ ولا الدخولَ أبداً. */
export async function maybeAwardAppInstall(subscriberId: number): Promise<void> {
  await ensureAppInstallTables();
  const row = await prisma.subscriberAppInstall.findUnique({ where: { subscriberId } });
  if (!row || row.legacy || row.awarded || row.agentId == null) return;

  const techs = await prisma.technician.findMany({ where: { agentId: row.agentId }, select: { id: true } });
  if (!techs.length) return;

  const first = row.firstLoginAt;
  const cards: CardLite[] = await prisma.taskCard.findMany({
    where: {
      isDeleted: false, done: true,
      technicianId: { in: techs.map((t) => t.id) },
      completedAt: { gte: new Date(first.getTime() - APP_INSTALL_WINDOW_MS), lte: new Date(first.getTime() + APP_INSTALL_WINDOW_MS) },
      createdAt: { lte: first },
    },
    select: { id: true, title: true, description: true, subscriberId: true, technicianId: true, createdAt: true },
    orderBy: { completedAt: "asc" },
    take: 500,
  });
  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { netUser: true } });
  const hit = cards.find((c) => cardMatchesSubscriber(c, subscriberId, sub?.netUser ?? null));
  if (!hit || hit.technicianId == null) return;

  const points = await agentAppInstallPoints(row.agentId);
  // الشرطُ `awarded: false` في الـwhere هو الحارس: نداءانِ متزامنانِ ⇒ منحةٌ واحدة
  await prisma.subscriberAppInstall.updateMany({
    where: { subscriberId, awarded: false },
    data: { awarded: true, awardedAt: new Date(), technicianId: hit.technicianId, cardId: hit.id, points },
  });
}

/** من نصّب التطبيقَ من هؤلاء؟ — يُستعلَم بمعرّفاتٍ معزولةٍ سلفاً (نمط `attachLoanFlag`). */
export async function installedSubscriberIds(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  await ensureAppInstallTables();
  try {
    const rows = await prisma.subscriberAppInstall.findMany({
      where: { subscriberId: { in: ids } },
      select: { subscriberId: true },
    });
    return new Set(rows.map((r) => r.subscriberId));
  } catch { return new Set(); } // لا شريطَ سماويّاً، ولا تنكسر صفحةُ المشتركين
}

/** جوائزُ تنصيب التطبيق في فترةٍ، مجموعةً بالفنيّ — لحساب الإنجازات. */
export async function appInstallBonuses(agentId: number | null, from: Date | null, to: Date | null): Promise<Map<number, { count: number; points: number }>> {
  const out = new Map<number, { count: number; points: number }>();
  if (agentId == null) return out;
  await ensureAppInstallTables();
  const rows = await prisma.subscriberAppInstall.findMany({
    where: {
      agentId, awarded: true, technicianId: { not: null },
      ...(from && to ? { awardedAt: { gte: from, lte: to } } : {}),
    },
    select: { technicianId: true, points: true },
  }).catch(() => [] as { technicianId: number | null; points: number | null }[]); // لا تنكسر لوحةُ الإنجازات
  for (const r of rows) {
    if (r.technicianId == null) continue;
    const a = out.get(r.technicianId) ?? { count: 0, points: 0 };
    a.count += 1;
    a.points += r.points ?? 0;
    out.set(r.technicianId, a);
  }
  return out;
}
