import { gzipSync, gunzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";

// ===== النسخ الاحتياطي والاسترجاع لكل وكيل (عزل المستأجر) =====
// يُصدّر كل بيانات الوكيل (المشتركون، الكروت، الباقات، القوالب، الحسابات،
// المصروفات، الفواتير، الفنيون، المكاتب...) المرتبطة عبر agentId أو towerId.
// يُستثنى: حسابات الدخول والبيانات الخاصّة بالحاسبة/الجلسات (لحماية الدخول الحالي).

const BACKUP_VERSION = 1;

// جداول لا تُنسخ ولا تُسترجع (دخول/جلسات/مؤقّتة/مرجعية عامة)
const EXCLUDE = new Set([
  "users",           // حسابات الدخول — تُدار لكل تنصيب (تفادي كسر الجلسة وتعارض أسماء المستخدمين)
  "hybrid_workers",  // حواسيب الهجين — خاصّة بكل جهاز
  "wa_sessions",     // جلسات واتساب — خاصّة بالجهاز
  "wa_relays",       // مؤقّتة
  "install_tokens",  // رموز تنصيب مؤقّتة
  "map_points",      // مرجع عام مشترك (ليس بيانات وكيل)
]);

type Row = Record<string, unknown>;

// JSON.stringify مع تحويل BigInt (يظهر من بعض الأعمدة العددية) لتفادي الخطأ
function jsonReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? Number(v) : v;
}

async function columnsWith(name: "agentId" | "towerId"): Promise<string[]> {
  // ملاحظة: table_name نوعه 'name' في Postgres — نحوّله إلى text ليقرأه سائق Neon
  const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name::text AS table_name FROM information_schema.columns WHERE table_schema='public' AND column_name=$1`,
    name,
  );
  return rows.map((r) => r.table_name).filter((t) => !EXCLUDE.has(t));
}

export type AgentBackup = {
  version: number;
  agentId: number;
  agentName: string | null;
  backupEmail: string | null;
  exportedAt: string;
  tables: Record<string, Row[]>; // اسم الجدول ← صفوفه
  settings: Row[];               // system_settings الخاصّة بالوكيل (قالب الوصل)
};

// تصدير نسخة الوكيل ككائن + نسخة مضغوطة (gzip) جاهزة للتنزيل/الإرسال
export async function exportAgentBackup(agentId: number): Promise<{ backup: AgentBackup; gz: Buffer; filename: string }> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, backupEmail: true } });
  const towers = await prisma.tower.findMany({ where: { agentId }, select: { id: true } });
  const towerIds = towers.map((t) => t.id);

  const tables: Record<string, Row[]> = {};

  // 1) جداول فيها agentId
  for (const t of await columnsWith("agentId")) {
    if (t === "agents") continue;
    tables[t] = await prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM "${t}" WHERE "agentId" = $1`, agentId);
  }
  // 2) جداول فيها towerId
  if (towerIds.length) {
    for (const t of await columnsWith("towerId")) {
      if (tables[t]) continue; // لا تكرّر إن كان له agentId أيضاً
      tables[t] = await prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM "${t}" WHERE "towerId" = ANY($1::int[])`, towerIds);
    }
    // 3) أبناء لوحات الفنيين (لا يملكون towerId مباشرةً — عبر العلاقة باللوحة)
    tables["task_lists"] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT l.* FROM task_lists l JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[])`, towerIds);
    tables["task_cards"] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT c.* FROM task_cards c JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[])`, towerIds);
    tables["card_photos"] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT p.* FROM card_photos p JOIN task_cards c ON c.id=p."cardId" JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[])`, towerIds);
  }

  // قالب الوصل الخاص بالوكيل في system_settings (type = receipt:{agentId})
  const settings = await prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM system_settings WHERE type = $1`, `receipt:${agentId}`);

  const backup: AgentBackup = {
    version: BACKUP_VERSION,
    agentId,
    agentName: agent?.name ?? null,
    backupEmail: agent?.backupEmail ?? null,
    exportedAt: new Date().toISOString(),
    tables,
    settings,
  };
  const gz = gzipSync(Buffer.from(JSON.stringify(backup, jsonReplacer)));
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (agent?.name ?? `agent-${agentId}`).replace(/[^\w؀-ۿ-]+/g, "_").slice(0, 40);
  return { backup, gz, filename: `backup-${safeName}-${stamp}.json.gz` };
}

// فكّ ملف نسخة (يقبل gzip أو JSON خام) إلى كائن
export function parseBackupFile(buf: Buffer): AgentBackup {
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const text = (isGzip ? gunzipSync(buf) : buf).toString("utf8");
  const obj = JSON.parse(text) as AgentBackup;
  if (!obj || typeof obj !== "object" || !obj.tables || typeof obj.version !== "number") {
    throw new Error("ملف النسخة غير صالح");
  }
  return obj;
}

// حذف كل بيانات الوكيل الحالية (تمهيداً للاستبدال الكامل) — عدا صف الوكيل نفسه
async function deleteAgentData(tx: typeof prisma, agentId: number) {
  const towers = await tx.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM towers WHERE "agentId" = $1`, agentId);
  const towerIds = towers.map((t) => t.id);
  if (towerIds.length) {
    // أبناء لوحات الفنيين أولاً
    await tx.$executeRawUnsafe(`DELETE FROM card_photos WHERE "cardId" IN (SELECT c.id FROM task_cards c JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]))`, towerIds).catch(() => {});
    await tx.$executeRawUnsafe(`DELETE FROM task_cards WHERE "listId" IN (SELECT l.id FROM task_lists l JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]))`, towerIds).catch(() => {});
    await tx.$executeRawUnsafe(`DELETE FROM task_lists WHERE "boardId" IN (SELECT id FROM task_boards WHERE "towerId" = ANY($1::int[]))`, towerIds).catch(() => {});
    const towerTables = await tx.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name::text AS table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='towerId'`);
    for (const { table_name } of towerTables) {
      if (EXCLUDE.has(table_name)) continue;
      await tx.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "towerId" = ANY($1::int[])`, towerIds).catch(() => {});
    }
  }
  const agentTables = await tx.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name::text AS table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='agentId' AND table_name <> 'agents'`);
  for (const { table_name } of agentTables) {
    if (EXCLUDE.has(table_name)) continue;
    await tx.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "agentId" = $1`, agentId).catch(() => {});
  }
  await tx.$executeRawUnsafe(`DELETE FROM system_settings WHERE type = $1`, `receipt:${agentId}`).catch(() => {});
}

// إدراج صفوف جدول (بأعمدتها وقيمها) مع إجبار agentId على الوكيل الهدف
async function insertRows(tx: typeof prisma, table: string, rows: Row[], targetAgentId: number, hasAgentId: boolean) {
  for (const row of rows) {
    const cols = Object.keys(row);
    if (cols.length === 0) continue;
    const values = cols.map((c) => {
      if (hasAgentId && c === "agentId") return targetAgentId; // ربط بالوكيل الهدف
      const v = row[c];
      // أعمدة JSON: مرّرها كنصّ JSON
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    const colList = cols.map((c) => `"${c}"`).join(",");
    const params = cols.map((_, i) => `$${i + 1}`).join(",");
    await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${colList}) VALUES (${params})`, ...values);
  }
}

// إعادة ضبط تسلسل المفتاح id بعد إدراج صفوف بمعرّفات صريحة (لتفادي تعارض المعرّفات لاحقاً)
async function resyncSequence(tx: typeof prisma, table: string) {
  await tx.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence($1,'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM "${table}"),1))
     WHERE pg_get_serial_sequence($1,'id') IS NOT NULL`, table,
  ).catch(() => {});
}

// استرجاع كامل (استبدال): يمسح بيانات الوكيل الحالية ويُدرج بيانات الملف تحت الوكيل الهدف
export async function importAgentBackup(targetAgentId: number, backup: AgentBackup): Promise<{ ok: boolean; tablesRestored: number; rowsRestored: number }> {
  const agentTableSet = new Set(await columnsWith("agentId"));

  let tablesRestored = 0, rowsRestored = 0;
  await prisma.$transaction(async (tx) => {
    await deleteAgentData(tx as typeof prisma, targetAgentId);

    for (const [table, rows] of Object.entries(backup.tables)) {
      if (EXCLUDE.has(table) || !Array.isArray(rows) || rows.length === 0) continue;
      const hasAgentId = agentTableSet.has(table);
      await insertRows(tx as typeof prisma, table, rows, targetAgentId, hasAgentId);
      await resyncSequence(tx as typeof prisma, table);
      tablesRestored++; rowsRestored += rows.length;
    }
    // قالب الوصل: يُخزَّن بمفتاح receipt:{targetAgentId}
    for (const s of backup.settings ?? []) {
      const text = s.text ?? null; const value = s.value ?? null;
      await tx.$executeRawUnsafe(
        `INSERT INTO system_settings (type, text, value) VALUES ($1,$2,$3)`,
        `receipt:${targetAgentId}`, text, value,
      ).catch(() => {});
    }
    // تحديث اسم العلامة وإيميل النسخ من الملف (دون المساس بانتهاء الاشتراك/النوع)
    if (backup.agentName) {
      await tx.$executeRawUnsafe(`UPDATE agents SET name = $1 WHERE id = $2`, backup.agentName, targetAgentId).catch(() => {});
    }
  }, { timeout: 120000 });

  return { ok: true, tablesRestored, rowsRestored };
}
