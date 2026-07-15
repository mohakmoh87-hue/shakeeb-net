import pg from "pg";

// ===== محرّك مزامنة local-first =====
// يزامن تزايدياً بين قاعدة العقدة المحلية وقاعدة السحابة (Neon) في الاتجاهين
// اعتماداً على عمود updatedAt. الدمج بقاعدة "آخر كاتب يفوز" (LWW) حسب updatedAt.
// مُستثنى من المزامنة العادية: كروت التفعيل (تُطلب حصراً من السحابة ذرّياً)،
// وجداول التحكّم/السجلات.

const EXCLUDE = new Set([
  "recharge_cards", // الكروت حصراً من السحابة (سحب ذرّي)
  "hybrid_workers", // مستوى التحكّم
  "audit_logs",     // السجل مرجعه السحابة
  "_prisma_migrations",
]);

export type SyncCursor = { push: Record<string, string>; pull: Record<string, string> };

async function tableColumns(c: pg.Client, table: string): Promise<string[]> {
  const r = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((x) => x.column_name as string);
}

async function syncableTables(c: pg.Client): Promise<string[]> {
  const r = await c.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
  );
  return r.rows.map((x) => x.table_name as string).filter((t) => !EXCLUDE.has(t));
}

// إدراج/تحديث صفوف في الوجهة مع LWW على updatedAt (لا نطمس أحدث بأقدم)
async function upsertRows(dest: pg.Client, table: string, cols: string[], rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const q = (s: string) => `"${s}"`;
  const colList = cols.map(q).join(",");
  const updates = cols.filter((c) => c !== "id").map((c) => `${q(c)}=EXCLUDED.${q(c)}`).join(",");
  const guard = cols.includes("updatedAt") ? `WHERE EXCLUDED."updatedAt" >= ${q(table)}."updatedAt"` : "";
  for (const row of rows) {
    const vals = cols.map((c) => row[c]);
    const ph = cols.map((_, i) => `$${i + 1}`).join(",");
    await dest.query(
      `INSERT INTO ${q(table)} (${colList}) VALUES (${ph}) ON CONFLICT ("id") DO UPDATE SET ${updates} ${guard}`,
      vals,
    );
  }
}

// نقل الصفوف المتغيّرة (updatedAt > المؤشّر) من src إلى dest؛ يعيد أحدث updatedAt رُئي
async function moveChanges(src: pg.Client, dest: pg.Client, table: string, cursor: string | undefined): Promise<{ moved: number; max: string | undefined }> {
  const cols = await tableColumns(src, table);
  if (!cols.includes("updatedAt")) return { moved: 0, max: cursor };
  const since = cursor ? new Date(cursor) : new Date(0);
  const r = await src.query(`SELECT * FROM "${table}" WHERE "updatedAt" > $1 ORDER BY "updatedAt" ASC LIMIT 1000`, [since]);
  await upsertRows(dest, table, cols, r.rows);
  let max = cursor;
  for (const row of r.rows) {
    const u = (row.updatedAt as Date).toISOString();
    if (!max || u > max) max = u;
  }
  return { moved: r.rows.length, max };
}

// دورة مزامنة واحدة: رفع تغييرات العقدة للسحابة ثم سحب تغييرات السحابة للعقدة.
export async function syncOnce(cloudUrl: string, localUrl: string, cursor: SyncCursor = { push: {}, pull: {} }): Promise<{ cursor: SyncCursor; pushed: number; pulled: number }> {
  const cloud = new pg.Client({ connectionString: cloudUrl });
  const local = new pg.Client({ connectionString: localUrl });
  await cloud.connect();
  await local.connect();
  try {
    const tables = await syncableTables(local);
    const next: SyncCursor = { push: { ...cursor.push }, pull: { ...cursor.pull } };
    let pushed = 0, pulled = 0;
    for (const t of tables) {
      const up = await moveChanges(local, cloud, t, cursor.push[t]);   // العقدة → السحابة
      if (up.max) next.push[t] = up.max; pushed += up.moved;
      const dn = await moveChanges(cloud, local, t, cursor.pull[t]);   // السحابة → العقدة
      if (dn.max) next.pull[t] = dn.max; pulled += dn.moved;
    }
    return { cursor: next, pushed, pulled };
  } finally {
    await cloud.end();
    await local.end();
  }
}
