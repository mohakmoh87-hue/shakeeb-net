import { prisma } from "./prisma";

// ═════ 🩺 جدولا سجلّ الفحص — إنشاءٌ كسولٌ على نمط `ensureMarketTable` ═════
//
// جدولان **جديدان يخصّان الميزة**، لا عمودٌ على جدولٍ مركزيّ — فالكسولُ مسموحٌ هنا
// (حارسُ `lazy-ddl-safety` يحصر المنعَ بالجداول المركزيّة التي تُقرأ بلا `select`).
//
// 🛡️ **وحاسبةُ المكتب تُشغّل نفسَ الموقع** بدور `agent_N_worker` وهو ليس مالكَ الجداول،
//    و`IF NOT EXISTS` تكتم خطأَ التكرار لا فحصَ الملكيّة ⇒ الـDDL يرمي هناك. فالمحاولةُ
//    **مرّةٌ واحدةٌ** ويُبتلَع فشلُها، والجداولُ تُنشأ من الموقع المالك. ولذلك أيضاً
//    `GRANT SELECT` على `diag_checks` في `02-grants.sql`: الحاسبةُ تقرأ السجلّ ولا تكتبه.
let ready = false;
let tried = false;

export async function ensureDiagTables(): Promise<void> {
  if (ready || tried) return;
  tried = true;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "diag_checks" (
      "id" SERIAL PRIMARY KEY,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "phoneCore" TEXT NOT NULL, "phone" TEXT NOT NULL,
      "subscriberId" INTEGER, "appAccountId" INTEGER, "towerId" INTEGER, "agentId" INTEGER,
      "ip" TEXT, "asn" INTEGER, "ispName" TEXT, "onSuperCell" BOOLEAN,
      "pkgMbps" DOUBLE PRECISION, "routerPingMs" DOUBLE PRECISION, "netPingMs" DOUBLE PRECISION,
      "linkMbps" DOUBLE PRECISION, "downMbps" DOUBLE PRECISION, "upMbps" DOUBLE PRECISION,
      "opticRx" DOUBLE PRECISION, "opticErr" TEXT, "opticDiag" TEXT,
      "devices" INTEGER, "deviceDiag" TEXT,
      "deviceSerial" TEXT, "deviceUser" TEXT, "netUser" TEXT,
      "summary" TEXT, "verdict" TEXT, "stages" JSONB,
      "refRaw" TEXT, "appVersion" TEXT, "platform" TEXT )`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "diag_checks" ADD COLUMN IF NOT EXISTS "opticDiag" TEXT`);
    // 🔎 أعمدةُ قراءةِ الراوتر — إضافةٌ على جدولٍ قائمٍ (ADD COLUMN IF NOT EXISTS، بلا حذف)
    await prisma.$executeRawUnsafe(`ALTER TABLE "diag_checks" ADD COLUMN IF NOT EXISTS "deviceSerial" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "diag_checks" ADD COLUMN IF NOT EXISTS "deviceUser" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "diag_checks" ADD COLUMN IF NOT EXISTS "netUser" TEXT`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "diag_checks_phoneCore_createdAt_idx" ON "diag_checks" ("phoneCore", "createdAt")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "diag_checks_subscriberId_createdAt_idx" ON "diag_checks" ("subscriberId", "createdAt")`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "asn_cache" (
      "prefix" TEXT PRIMARY KEY, "asn" INTEGER, "holder" TEXT,
      "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "diag_checks" ENABLE ROW LEVEL SECURITY`);
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS rls_diag_checks ON "diag_checks"`);
    await prisma.$executeRawUnsafe(`CREATE POLICY rls_diag_checks ON "diag_checks" TO agent_worker USING ("agentId" = current_agent_id()) WITH CHECK ("agentId" = current_agent_id())`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "asn_cache" ENABLE ROW LEVEL SECURITY`);
    await prisma.$executeRawUnsafe(`GRANT SELECT ON "diag_checks" TO agent_worker`);
    ready = true;
  } catch { /* حاسبةُ المكتب ليست مالكةً — الجداولُ منشأةٌ من الموقع، فلا تُسقَط الصفحة */ }
}
