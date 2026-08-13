// ===== أ-٢٣ · مواءمةُ أعمدة المكتب مع لوحته الأولى =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/align-primary-panels.mjs         ← عرضٌ فقط
//   DATABASE_URL="…" node scripts/align-primary-panels.mjs --apply                   ← تنفيذ
//
// حادثةُ صميم (2026-08-13): رابطُ الساس كان في موضعَين مختلفَين — اللوحةُ الأولى
// `reseller.scn-ftth.com` وعمودُ المكتب `82.129.22.22`. والمزامنةُ صارت آليّةً في الاتّجاهَين،
// لكنّها لا تُصلح ما تباعد قبلها. وهذا السكربتُ يُصلحه.
//
// 🔑 والاتّجاهُ **من اللوحة إلى المكتب** لا العكس، ولذلك دليلٌ لا ذوق: مشتركو صميم كلُّهم
// موسومون بلوحةٍ (`sasPanelId`) ⇒ **اللوحةُ هي التي تُفعِّل فعلاً**، وعمودُ المكتب نائمٌ لا
// يقرؤه أحدٌ لمشتركٍ موسوم. فالكتابةُ في النائم لا تُغيّر سلوكاً قائماً — والعكس يُغيّر
// مُخدِّمَ ٢١٧٢ مشتركاً.
//
// ولا يُمَسّ إلّا مكتبٌ **له لوحةٌ أولى** وقيمتُه تختلف عنها. قراءةٌ أوّلاً ثمّ تنفيذٌ بعلَم.
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const c = new Client({ connectionString: url });

async function main() {
  await c.connect();
  const rows = (await c.query(`
    SELECT t.id, t.name,
           t."loginUrl" AS t_url, p."loginUrl" AS p_url,
           t.username  AS t_user, p.username  AS p_user,
           (t.password IS DISTINCT FROM p.password) AS pw_diff,
           (SELECT count(*)::int FROM subscribers s WHERE s."towerId"=t.id AND s."isDeleted"=false AND s."sasPanelId" IS NULL) AS unstamped
    FROM towers t
    JOIN sas_panels p ON p."towerId" = t.id AND p."isPrimary" = true AND p."isDeleted" = false
    WHERE t."isDeleted" = false
      AND (t."loginUrl" IS DISTINCT FROM p."loginUrl"
        OR t.username  IS DISTINCT FROM p.username
        OR t.password  IS DISTINCT FROM p.password)
    ORDER BY t.id`)).rows;

  if (!rows.length) { console.log("✅ لا تباعُدَ — كلُّ مكتبٍ مُطابقٌ لوحتَه الأولى"); await c.end(); return; }

  console.log(`— ${rows.length} مكتباً متباعداً عن لوحته الأولى:\n`);
  for (const r of rows) {
    console.log(`  #${r.id} ${r.name}`);
    if (r.t_url !== r.p_url) console.log(`     الرابط : المكتب «${r.t_url}»  ←  اللوحة «${r.p_url}»`);
    if (r.t_user !== r.p_user) console.log(`     المستخدم: المكتب «${r.t_user}»  ←  اللوحة «${r.p_user}»`);
    if (r.pw_diff) console.log(`     كلمةُ المرور مختلفة`);
    console.log(`     ⚠️ مشتركون بلا وسمِ لوحةٍ (يقرؤون عمودَ المكتب): ${r.unstamped}`);
  }

  if (!APPLY) { console.log("\n(عرضٌ فقط — أضِف --apply للتنفيذ)"); await c.end(); return; }

  const upd = await c.query(`
    UPDATE towers t
    SET "loginUrl" = p."loginUrl", username = p.username, password = p.password
    FROM sas_panels p
    WHERE p."towerId" = t.id AND p."isPrimary" = true AND p."isDeleted" = false
      AND t."isDeleted" = false
      AND (t."loginUrl" IS DISTINCT FROM p."loginUrl"
        OR t.username  IS DISTINCT FROM p.username
        OR t.password  IS DISTINCT FROM p.password)`);
  console.log(`\n✅ وُوئمت ${upd.rowCount} مكتباً من لوحتها الأولى`);
  await c.end();
}

main().catch(async (e) => { console.error("🔴", e.message); await c.end().catch(() => {}); process.exit(1); });
