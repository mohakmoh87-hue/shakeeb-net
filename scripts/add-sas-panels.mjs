#!/usr/bin/env node
/**
 * أ-٢٣ · مهاجرةُ «لوحات الساس/أودو» — الدفعةُ الأولى: **إضافةٌ صافيةٌ لا تُغيّر سلوكاً**.
 *
 * ما تفعله:
 *   ١) جدول `sas_panels` + عمودا الربط (`subscribers.sasPanelId` · `agents.multiSasAllowed`).
 *   ٢) لوحةٌ **أولى** لكلّ مكتبٍ حيٍّ، منسوخةٌ من أعمدته الحاليّة (`isPrimary=true`).
 *   ٣) GRANT + سياسةُ RLS للوكلاء — **القاعدةُ الذهبيّة: كلُّ كتابةٍ جديدة = GRANT + سياسة**،
 *      وبلا الاثنين يعمل الموقعُ وتسقط حاسباتُ المكاتب صامتةً.
 *
 * ما لا تفعله: **لا تُسند مشتركاً إلى لوحةٍ ولا تدمج مكتباً**. فـ`sasPanelId` يبقى فارغاً
 * للجميع ⇒ كلُّ قارئٍ يسقط إلى أعمدة المكتب كما اليوم. ودمجُ صميم في سكربتٍ منفصلٍ لاحق.
 *
 * التشغيل:  node scripts/add-sas-panels.mjs            (فحصٌ فقط — لا يكتب شيئاً)
 *           node scripts/add-sas-panels.mjs --apply    (يُنفّذ)
 * ويُعاد تشغيلُه بأمان: كلُّ خطوةٍ `IF NOT EXISTS` أو مشروطةٌ بعدم الوجود.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const pg = require_("pg");

const APPLY = process.argv.includes("--apply");

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // مساعدةٌ محليّة: يقرأ الرابطَ من ملفّ أسرار حقيبة النجاة إن وُجد
  for (const p of [
    `${process.env.USERPROFILE ?? ""}/OneDrive/Desktop/حقيبة النجاة/secrets-railway.env`,
  ]) {
    try {
      const line = readFileSync(p, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_PUBLIC_URL="));
      if (line) {
        const u = line.slice("DATABASE_PUBLIC_URL=".length).trim();
        return u + (u.includes("?") ? "&" : "?") + "sslmode=no-verify";
      }
    } catch { /* التالي */ }
  }
  throw new Error("لا DATABASE_URL — صدّره أوّلاً");
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS sas_panels (
     id                 serial PRIMARY KEY,
     "towerId"          integer NOT NULL,
     "agentId"          integer,
     label              text,
     "sortOrder"        integer NOT NULL DEFAULT 0,
     "isPrimary"        boolean NOT NULL DEFAULT false,
     "isDeleted"        boolean NOT NULL DEFAULT false,
     "loginUrl"         text,
     username           text,
     password           text,
     "activationTemplate" text,
     "odooEnabled"      text DEFAULT '0',
     "odooUrl"          text DEFAULT 'https://odoo.supercell.iq',
     "odooUser"         text,
     "odooPass"         text,
     "odooUid"          integer,
     "odooLastOk"       timestamp(3),
     "odooLastError"    text,
     "odooLastTicketId" integer,
     "createdAt"        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt"        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS sas_panels_tower_idx ON sas_panels ("towerId")`,
  `CREATE INDEX IF NOT EXISTS sas_panels_agent_idx ON sas_panels ("agentId")`,
  `ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS "sasPanelId" integer`,
  `CREATE INDEX IF NOT EXISTS subscribers_saspanel_idx ON subscribers ("sasPanelId")`,
  // حصّةٌ بعددٍ لا مفتاحٌ ثنائيّ (طلب محمد 2026-08-13): كم مكتباً يُسمح له بأكثر من لوحة.
  // صفر = الوضعُ الحاليّ.
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS "multiSasOffices" integer NOT NULL DEFAULT 0`,
  // 🔴 **لا تُسقط `multiSasAllowed` هنا.** أسقطتُها فسقطت لوحةُ المالك في الإنتاج فوراً (بلاغ
  // محمد 2026-08-13: «لا يظهر لي أيُّ وكيل»): النشرةُ الحيّةُ كانت مبنيّةً على مخطّطٍ يحمل
  // العمود، وبريزما تُسمّي الأعمدةَ صراحةً في كلّ `SELECT` ⇒ عمودٌ مفقودٌ = فشلُ الاستعلام
  // = قائمةُ وكلاءَ فارغة. والعمودُ الزائدُ لا يضرّ أحداً.
  // ⇒ **القاعدة: انشر الكودَ الذي لا يستعمل العمود أوّلاً، ثمّ أسقِطه في دفعةٍ تالية** —
  //    وإسقاطُه ليس عاجلاً أصلاً. يُترك للتنظيف اليدويّ بعد استقرار النشرة.
];

// 🔴 العزل: بلا GRANT وسياسةٍ تسقط حاسباتُ المكاتب صامتةً عند أوّل قراءةٍ للجدول الجديد.
// ⚠️ والنمطُ مأخوذٌ من سياساتك القائمة حرفيّاً — فُحصت قبل الكتابة:
//     towers.rls_towers          → ("agentId" = current_agent_id())
//     subscribers.rls_subscribers → ("towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id()))
// ⇒ تُستعمل الدالّةُ `current_agent_id()` **لا** `split_part(current_user,…)`، والاسمُ `rls_<جدول>`.
const RLS = [
  `ALTER TABLE sas_panels ENABLE ROW LEVEL SECURITY`,
  `GRANT SELECT, INSERT, UPDATE ON sas_panels TO agent_worker`,
  `GRANT USAGE, SELECT ON SEQUENCE sas_panels_id_seq TO agent_worker`,
  `DROP POLICY IF EXISTS rls_sas_panels ON sas_panels`,
  // الشرطُ على المكتب (كنمط `subscribers`) لأنّ `agentId` هنا نسخةٌ مساعدةٌ قد تكون فارغة
  `CREATE POLICY rls_sas_panels ON sas_panels USING (
     "towerId" IN (SELECT id FROM towers WHERE "agentId" = current_agent_id())
   )`,
];

const c = new pg.Client({ connectionString: dbUrl() });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;

console.log(`\n${APPLY ? "🔧 تنفيذ" : "🔍 فحصٌ فقط (أضِف --apply للتنفيذ)"}\n`);

// ── ١) الحالةُ قبل ──
const has = async (t, col) =>
  (await q(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, col])).length > 0;
const tableExists = (await q(`SELECT 1 FROM information_schema.tables WHERE table_name='sas_panels'`)).length > 0;
console.log(`جدول sas_panels: ${tableExists ? "موجود" : "غير موجود"}`);
console.log(`subscribers.sasPanelId: ${(await has("subscribers", "sasPanelId")) ? "موجود" : "غير موجود"}`);
console.log(`agents.multiSasAllowed: ${(await has("agents", "multiSasAllowed")) ? "موجود" : "غير موجود"}`);

const towers = await q(`SELECT id, name, "agentId", "loginUrl", username, password, "activationTemplate",
    "odooEnabled", "odooUrl", "odooUser", "odooPass", "odooUid"
  FROM towers WHERE "isDeleted" = false ORDER BY id`);
console.log(`\nمكاتبٌ حيّة: ${towers.length}`);

if (!APPLY) {
  console.log("\nستُنشأ لوحةٌ أولى لكلّ مكتب:");
  for (const t of towers) console.log(`  ${t.id} · ${t.name} — ساس ${t.loginUrl ? "✓" : "—"} · أودو ${t.odooEnabled === "1" ? "مُفعَّل" : "خامد"}`);
  await c.end();
  process.exit(0);
}

// ── ٢) الأعمدةُ والجدول ──
for (const s of DDL) { await c.query(s); }
console.log("✓ الجدولُ والأعمدة");

// ── ٣) اللوحةُ الأولى لكلّ مكتب (مرّةً واحدةً — تُتخطّى إن وُجدت) ──
let made = 0;
for (const t of towers) {
  const exists = await q(`SELECT 1 FROM sas_panels WHERE "towerId"=$1 AND "isPrimary"=true`, [t.id]);
  if (exists.length) continue;
  await c.query(
    `INSERT INTO sas_panels ("towerId","agentId",label,"sortOrder","isPrimary",
        "loginUrl",username,password,"activationTemplate",
        "odooEnabled","odooUrl","odooUser","odooPass","odooUid")
     VALUES ($1,$2,$3,0,true,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [t.id, t.agentId, t.name, t.loginUrl, t.username, t.password, t.activationTemplate,
     t.odooEnabled, t.odooUrl, t.odooUser, t.odooPass, t.odooUid],
  );
  made++;
}
console.log(`✓ لوحاتٌ أولى مُنشأة: ${made} (والموجودةُ تُركت)`);

// ── ٤) العزل ──
for (const s of RLS) {
  try { await c.query(s); } catch (e) { console.log(`  ⚠️ ${String(e.message).slice(0, 90)}`); }
}
console.log("✓ RLS + GRANT + سياسة");

// ── ٥) تحقُّقٌ بعد ──
const panels = await q(`SELECT p.id, p."towerId", p.label, p."isPrimary", (p."loginUrl" IS NOT NULL) AS "له ساس"
  FROM sas_panels p ORDER BY p."towerId"`);
console.table(panels);
const pol = await q(`SELECT policyname FROM pg_policies WHERE tablename='sas_panels'`);
const gr = await q(`SELECT privilege_type FROM information_schema.role_table_grants
  WHERE table_name='sas_panels' AND grantee='agent_worker' ORDER BY 1`);
console.log(`سياسات: ${pol.map((x) => x.policyname).join(", ") || "✗ لا شيء"}`);
console.log(`صلاحياتُ agent_worker: ${gr.map((x) => x.privilege_type).join(", ") || "✗ لا شيء"}`);
const orphan = await q(`SELECT count(*)::int n FROM subscribers WHERE "sasPanelId" IS NOT NULL`);
console.log(`مشتركون مُسنَدون إلى لوحة: ${orphan[0].n} (يجب أن يكون صفراً في هذه الدفعة)`);

await c.end();
console.log("\n✅ تمّت الدفعةُ الأولى — بلا أيّ تغييرٍ في السلوك.\n");
