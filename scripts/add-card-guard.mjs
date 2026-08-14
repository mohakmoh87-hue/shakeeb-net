// ═════ 🛡️ حارسُ المال · جدولُ الكروت المحذوفة (طلبُ محمد 2026-08-14) ═════
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-card-guard.mjs
//
// شرطُ محمد المطلق: «فلا يكون هنالك مرورٌ لكارتٍ محذوفٍ بلا فحص الحارس له».
// وهذا الجدولُ هو **ذاكرةُ** الحارس: لقطةُ الصفّ **قبل** حذفه، بسيريالِه ورمزِه.
//
// 🔴 ولماذا الرمزُ والسيريالُ لا المُعرِّفُ وحدَه؟ لأنّ ٧٤ كارتاً حقيقيّاً حُذفت في ٩ آب
//   وسجلُّ التدقيق كتب `cardIds` فقط — والصفوفُ محذوفة ⇒ المُعرِّفُ رقمٌ لا يدلّ على شيء.
//   فلم يُمكن إثباتُها إلّا بقائمةِ سيريالاتٍ أرسلها محمد بيده. ولا تتكرّر هذه.
//
// 🔒 والجدولُ يُولَد **بسياسةِ عزلٍ وأذونٍ من يومه الأوّل** — لا لاحقاً: قاعدةُ المستودع
//   «كلُّ كتابةٍ جديدةٍ = GRANT + سياسة»، ونسيانُها يعني تسريباً بين الوكلاء.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log("═══ 🛡️ حارسُ المال · جدولُ deleted_card_logs ═══\n");

  const exists = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name='deleted_card_logs'`);
  if (exists.rowCount) {
    console.log("• الجدولُ موجودٌ سابقاً — تُفحَص الأعمدةُ الناقصةُ فقط");
  } else {
    await c.query(`
      CREATE TABLE deleted_card_logs (
        id             SERIAL PRIMARY KEY,
        "agentId"      INTEGER,
        "cardId"       INTEGER,
        serial         TEXT,
        number         TEXT,
        password       TEXT,
        "addDate"      TIMESTAMP(3),
        "userName"     TEXT,
        price          DOUBLE PRECISION,
        "packageId"    INTEGER,
        "towerId"      INTEGER,
        "useDate"      TIMESTAMP(3),
        "subscriberId" INTEGER,
        "deletedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        "deletedBy"    TEXT,
        reason         TEXT,
        verdict        TEXT NOT NULL DEFAULT 'pending',
        "verdictAt"    TIMESTAMP(3),
        "handledAction" TEXT,
        "handledAt"    TIMESTAMP(3),
        "handledBy"    TEXT,
        "handledNote"  TEXT,
        "restoredCardId" INTEGER,
        "sasInfo"      TEXT
      )`);
    await c.query(`CREATE INDEX "deleted_card_logs_agentId_idx" ON deleted_card_logs ("agentId")`);
    await c.query(`CREATE INDEX "deleted_card_logs_verdict_idx" ON deleted_card_logs (verdict)`);
    await c.query(`CREATE INDEX "deleted_card_logs_serial_idx" ON deleted_card_logs (serial)`);
    console.log("✅ أُنشئ الجدولُ بثلاثةِ فهارس");
  }

  // أعمدةٌ قد تكون ناقصةً إن كان الجدولُ من نسخةٍ أقدم — يُعاد تشغيلُ السكربت بلا ضرر
  const cols = {
    number: "TEXT", password: "TEXT", '"addDate"': "TIMESTAMP(3)", '"userName"': "TEXT",
    '"handledAction"': "TEXT", '"handledAt"': "TIMESTAMP(3)", '"handledBy"': "TEXT",
    '"handledNote"': "TEXT", '"restoredCardId"': "INTEGER",
  };
  for (const [col, type] of Object.entries(cols)) {
    const bare = col.replace(/"/g, "");
    const has = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='deleted_card_logs' AND column_name=$1`, [bare]);
    if (has.rowCount) continue;
    await c.query(`ALTER TABLE deleted_card_logs ADD COLUMN ${col} ${type}`);
    console.log(`✅ أُضيف ${bare} ${type}`);
  }

  // ═══ الأذون: دورُ العامل يقرأ ويكتب (المزامنةُ قد تحذف كارتاً غداً) ═══
  await c.query(`GRANT SELECT, INSERT, UPDATE ON deleted_card_logs TO agent_worker`);
  await c.query(`GRANT USAGE, SELECT ON SEQUENCE deleted_card_logs_id_seq TO agent_worker`);
  console.log("✅ GRANT SELECT/INSERT/UPDATE + تسلسلُ المُعرِّف لدور agent_worker");

  // ═══ 🔒 سياسةُ العزل — بنفسِ صيغةِ recharge_cards حرفيّاً ═══
  await c.query(`ALTER TABLE deleted_card_logs ENABLE ROW LEVEL SECURITY`);
  await c.query(`DROP POLICY IF EXISTS rls_deleted_card_logs ON deleted_card_logs`);
  await c.query(`
    CREATE POLICY rls_deleted_card_logs ON deleted_card_logs TO agent_worker
      USING ("agentId" = current_agent_id())
      WITH CHECK ("agentId" = current_agent_id())`);
  console.log("✅ RLS + سياسةُ agentId = current_agent_id()");

  // ═══ التحقّق: أنّ العزلَ **فعّالٌ** لا مُعلَنٌ فقط ═══
  const chk = await c.query(`
    SELECT relrowsecurity AS on,
           (SELECT count(*) FROM pg_policies WHERE tablename='deleted_card_logs') AS pol
      FROM pg_class WHERE relname='deleted_card_logs'`);
  console.log(`\n🔍 RLS مفعّل: ${chk.rows[0].on} · عددُ السياسات: ${chk.rows[0].pol}`);
  const n = await c.query(`SELECT count(*)::int AS n FROM deleted_card_logs`);
  console.log(`📦 صفوفُ الجدول الآن: ${n.rows[0].n}`);
  console.log("\n✅ تمّ. الحارسُ صار له ذاكرةٌ — ولا كارتَ يُحذَف بعد الآن بلا لقطةٍ وفحص.");
} finally { await c.end(); }
