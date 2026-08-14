// ═════ 🎯 تكليفُ حالاتِ حارس المال + توجيهُ الإشعارات (طلبُ محمد 2026-08-14) ═════
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-guard-assign.mjs
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log("═══ تكليفُ الحالات ═══\n");
  // ١) مُخاطَبُ الإشعار — و`null` تعني «للجميع» فلا يتغيّر شيءٌ لِما مضى
  for (const col of ["userId", "technicianId"]) {
    const has = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name=$1`, [col]);
    if (has.rowCount) { console.log(`• notifications.${col} موجودٌ سابقاً`); continue; }
    await c.query(`ALTER TABLE notifications ADD COLUMN "${col}" INTEGER`);
    console.log(`✅ أُضيف notifications.${col}`);
  }
  const idx = await c.query(`SELECT 1 FROM pg_indexes WHERE tablename='notifications' AND indexname='notifications_to_idx'`);
  if (!idx.rowCount) {
    await c.query(`CREATE INDEX "notifications_to_idx" ON notifications ("userId", "technicianId")`);
    console.log("✅ فهرسُ المُخاطَب");
  }

  // ٢) جدولُ التكليف
  const t = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name='guard_assignments'`);
  if (t.rowCount) console.log("• guard_assignments موجودٌ سابقاً");
  else {
    await c.query(`
      CREATE TABLE guard_assignments (
        id              SERIAL PRIMARY KEY,
        "agentId"       INTEGER NOT NULL,
        "checkKey"      TEXT NOT NULL,
        "rowKey"        TEXT NOT NULL,
        "toUserId"      INTEGER,
        "toTechnicianId" INTEGER,
        "toName"        TEXT,
        note            TEXT,
        "taskCardId"    INTEGER,
        "assignedBy"    TEXT,
        "assignedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        "doneAt"        TIMESTAMP(3),
        "doneNote"      TEXT
      )`);
    await c.query(`CREATE UNIQUE INDEX "guard_assignments_agentId_checkKey_rowKey_key" ON guard_assignments ("agentId","checkKey","rowKey")`);
    await c.query(`CREATE INDEX "guard_assignments_agentId_idx" ON guard_assignments ("agentId")`);
    await c.query(`CREATE INDEX "guard_assignments_toUserId_idx" ON guard_assignments ("toUserId")`);
    await c.query(`CREATE INDEX "guard_assignments_toTechnicianId_idx" ON guard_assignments ("toTechnicianId")`);
    console.log("✅ أُنشئ guard_assignments (وقيدٌ فريدٌ يمنع تكليفَ الحالة مرّتَين)");
  }

  // ٣) الأذون والعزل — قاعدةُ المستودع: كلُّ كتابةٍ جديدة = GRANT + سياسة
  await c.query(`GRANT SELECT, INSERT, UPDATE ON guard_assignments TO agent_worker`);
  await c.query(`GRANT USAGE, SELECT ON SEQUENCE guard_assignments_id_seq TO agent_worker`);
  await c.query(`ALTER TABLE guard_assignments ENABLE ROW LEVEL SECURITY`);
  await c.query(`DROP POLICY IF EXISTS rls_guard_assignments ON guard_assignments`);
  await c.query(`CREATE POLICY rls_guard_assignments ON guard_assignments TO agent_worker
    USING ("agentId" = current_agent_id()) WITH CHECK ("agentId" = current_agent_id())`);
  console.log("✅ GRANT + RLS + سياسةُ agentId");

  // وأعمدةُ الإشعار الجديدةُ تحتاج GRANT لكلّ دورٍ يكتب إشعارات
  const rows = (await c.query(
    `SELECT DISTINCT grantee, privilege_type FROM information_schema.table_privileges
      WHERE table_name='notifications' AND grantee LIKE 'agent%'`)).rows;
  for (const r of rows) {
    if (!["SELECT", "INSERT", "UPDATE"].includes(r.privilege_type)) continue;
    for (const col of ["userId", "technicianId"]) {
      await c.query(`GRANT ${r.privilege_type} ("${col}") ON notifications TO "${r.grantee}"`).catch(() => {});
    }
  }
  console.log(`✅ أذونُ عمودَي المُخاطَب على notifications (${rows.length} صفَّ أذونٍ فُحص)`);

  // ٤) 🔒 عمودٌ خاصّ: خاصيّةُ رؤيةٍ على مستوى العمود (طلبُ محمد)
  const pcol = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='task_lists' AND column_name='privateToAssignee'`);
  if (pcol.rowCount) console.log("• task_lists.privateToAssignee موجودٌ سابقاً");
  else {
    await c.query(`ALTER TABLE task_lists ADD COLUMN "privateToAssignee" BOOLEAN NOT NULL DEFAULT false`);
    console.log("✅ أُضيف task_lists.privateToAssignee (افتراضُه false فلا يتغيّر عمودٌ قائم)");
  }
  const rows2 = (await c.query(
    `SELECT DISTINCT grantee, privilege_type FROM information_schema.table_privileges
      WHERE table_name='task_lists' AND grantee LIKE 'agent%'`)).rows;
  for (const r of rows2) {
    if (!["SELECT", "INSERT", "UPDATE"].includes(r.privilege_type)) continue;
    await c.query(`GRANT ${r.privilege_type} ("privateToAssignee") ON task_lists TO "${r.grantee}"`).catch(() => {});
  }
  console.log(`✅ أذونُ العمود الخاصّ (${rows2.length} صفَّ أذونٍ فُحص)`);

  // ٥) 🔍 جدولُ فحصِ الكروت في الساس — «الحارسُ يفحص أين الكارتُ ثمّ يُعطي الحالة»
  const t2 = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name='card_sas_checks'`);
  if (t2.rowCount) console.log("• card_sas_checks موجودٌ سابقاً");
  else {
    await c.query(`
      CREATE TABLE card_sas_checks (
        id             SERIAL PRIMARY KEY,
        "agentId"      INTEGER NOT NULL,
        serial         TEXT NOT NULL,
        "cardId"       INTEGER,
        "subscriberId" INTEGER,
        "sasUsername"  TEXT,
        "sasName"      TEXT,
        "sasMethod"    TEXT,
        "sasCreatedAt" TEXT,
        "sasOldExpiry" TEXT,
        "sasNewExpiry" TEXT,
        "sasPrice"     DOUBLE PRECISION,
        verdict        TEXT NOT NULL,
        "checkedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
      )`);
    await c.query(`CREATE UNIQUE INDEX "card_sas_checks_agentId_serial_key" ON card_sas_checks ("agentId", serial)`);
    await c.query(`CREATE INDEX "card_sas_checks_agentId_verdict_idx" ON card_sas_checks ("agentId", verdict)`);
    console.log("✅ أُنشئ card_sas_checks");
  }
  await c.query(`GRANT SELECT, INSERT, UPDATE ON card_sas_checks TO agent_worker`);
  await c.query(`GRANT USAGE, SELECT ON SEQUENCE card_sas_checks_id_seq TO agent_worker`);
  await c.query(`ALTER TABLE card_sas_checks ENABLE ROW LEVEL SECURITY`);
  await c.query(`DROP POLICY IF EXISTS rls_card_sas_checks ON card_sas_checks`);
  await c.query(`CREATE POLICY rls_card_sas_checks ON card_sas_checks TO agent_worker
    USING ("agentId" = current_agent_id()) WITH CHECK ("agentId" = current_agent_id())`);
  console.log("✅ GRANT + RLS لفحوصِ الكروت");

  const chk = await c.query(`SELECT relrowsecurity AS on FROM pg_class WHERE relname='guard_assignments'`);
  console.log(`\n🔍 RLS على التكليفات: ${chk.rows[0]?.on}`);
  console.log("✅ تمّ.");
} finally { await c.end(); }
