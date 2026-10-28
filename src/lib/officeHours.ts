import { prisma } from "@/lib/prisma";

// ═════ 🕘 أوقاتُ عمل المكاتب — طلبُ محمد 2026-10-28 ═════
// تظهر على خريطة التغطية مع كلّ مكتب، ومع المكتب الذي يستقبل طلبَ الصيانة/التوصيل.
//
// 🔑 **جدولٌ جانبيٌّ لا عمودٌ على `towers`**: جدولُ المكاتب **مركزيٌّ** تقرؤه مساراتٌ كثيرةٌ
//    بلا `select`، والعمودُ الكسولُ عليه ممنوعٌ (حادثةُ `subscribers.appNickname`) — وغيرُ
//    الكسول يوجب ALTER على الإنتاج قبل النشر. والجانبيُّ يُنشأ كسولاً بلا شيءٍ من ذلك.
//
// 🔴 وحاسبةُ المكتب تُشغّل نفسَ الموقع بدورٍ **بلا DDL**: فالإنشاءُ محاولةٌ واحدةٌ مبتلَعةُ
//    الفشل، وكلُّ قراءةٍ تتحمّل غيابَ الجدول/الإذن. وللعامل `SELECT/INSERT/UPDATE` في
//    ملفّ الأذون كي يضبط المديرُ أوقاتَ مكتبه من حاسبته أيضاً.
//
// النصُّ حرٌّ عمداً («٩ ص – ٩ م · الجمعة عطلة») — فأوقاتُ المكاتب لا تنضبط بقالبٍ واحد.

export const MAX_HOURS = 120;

let ready = false;
let tried = false;
export async function ensureTowerHoursTable(): Promise<void> {
  if (ready || tried) return;
  tried = true;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "tower_hours" (
      "id" SERIAL PRIMARY KEY,
      "towerId" INTEGER NOT NULL, "agentId" INTEGER,
      "hours" TEXT NOT NULL DEFAULT '',
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "tower_hours_towerId_key" ON "tower_hours" ("towerId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "tower_hours_agentId_idx" ON "tower_hours" ("agentId")`);
    ready = true;
  } catch { /* حاسبةُ مكتبٍ بلا DDL — الجدولُ منشأٌ من الموقع */ }
}

export function cleanHours(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_HOURS) : "";
}

/** أوقاتُ عملِ مكاتبَ بعينها — يُستعلَم بمعرّفاتٍ معزولةٍ سلفاً (نمط `attachLoanFlag`). */
export async function towerHoursMap(towerIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const ids = [...new Set(towerIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return out;
  await ensureTowerHoursTable();
  try {
    const rows = await prisma.towerHours.findMany({
      where: { towerId: { in: ids } },
      select: { towerId: true, hours: true },
    });
    for (const r of rows) if (r.hours.trim()) out.set(r.towerId, r.hours);
  } catch { /* لا جدولَ/إذن ⇒ بلا أوقات، ولا تنكسر الصفحةُ التي استدعتها */ }
  return out;
}

export async function setTowerHours(towerId: number, agentId: number | null, hours: string): Promise<string> {
  await ensureTowerHoursTable();
  const v = cleanHours(hours);
  await prisma.towerHours.upsert({
    where: { towerId },
    update: { hours: v, agentId },
    create: { towerId, agentId, hours: v },
  });
  return v;
}
