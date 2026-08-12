#!/usr/bin/env node
/**
 * أ-٢٣/٥ · دمجُ مكتبٍ في مكتبٍ آخرَ كـ«لوحةِ ساس ثانية» — بلا ضياعِ صفٍّ واحد.
 *
 * طلبُ محمد 2026-08-13: «نفّذ هجرة صميم٢ إلى صميم١ ثمّ امسح صميم٢».
 * والمبدأ: «المكتب» وحدةُ عمل و«لوحةُ الساس» نقطةُ بنيةٍ تحتيّة ⇒ المكتبان يصيران مكتباً
 * واحداً (مشتركون · مال · مخزن · فنيّون · تقرير · واتساب · وصل **واحد**)، ولوحتان تُحدّدان
 * مُخدِّمَ الساس/أودو لكلّ مشترك.
 *
 * التشغيل:
 *   node scripts/merge-office-into-panel.mjs --from=44 --into=43           (فحصٌ — لا يكتب)
 *   node scripts/merge-office-into-panel.mjs --from=44 --into=43 --apply   (ينفّذ في معاملةٍ واحدة)
 *
 * 🔒 ضماناتٌ قبل أيّ كتابة (وأيُّ إخلالٍ يُوقف كلَّ شيء):
 *   ١) المكتبان لوكيلٍ واحد — فلا دمجَ عبر المستأجرين.
 *   ٢) حصّةُ المالك تسمح (`multiSasOffices`).
 *   �threeَ) **صفرُ تصادمٍ في (towerId, sasId)** — وإلّا انتهك القيدَ الفريدَ وضاع مشترك.
 *   ٤) كلُّ الكتابةِ في **معاملةٍ واحدة**: إمّا تتمّ كلُّها أو لا شيء.
 *   ٥) المكتبُ المصدرُ **حذفٌ ناعمٌ** لا فعليّ — يبقى بكلّ تاريخه ويُمكن الرجوع.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");

const arg = (k, d = null) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=")[1] : d;
};
const FROM = Number(arg("from"));
const INTO = Number(arg("into"));
const APPLY = process.argv.includes("--apply");
if (!Number.isInteger(FROM) || !Number.isInteger(INTO) || FROM === INTO) {
  console.error("الاستعمال: --from=<مكتب المصدر> --into=<مكتب الهدف> [--apply]");
  process.exit(1);
}

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const p = `${process.env.USERPROFILE ?? ""}/OneDrive/Desktop/حقيبة النجاة/secrets-railway.env`;
  const line = readFileSync(p, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_PUBLIC_URL="));
  const u = line.slice("DATABASE_PUBLIC_URL=".length).trim();
  return u + (u.includes("?") ? "&" : "?") + "sslmode=no-verify";
}

const c = new pg.Client({ connectionString: dbUrl() });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];

console.log(`\n${APPLY ? "🔧 تنفيذ" : "🔍 فحصٌ فقط (أضِف --apply للتنفيذ)"} — دمجُ ${FROM} في ${INTO}\n`);

// ───── ١) المكتبان ─────
const src = await one(`SELECT id, name, "agentId", "isDeleted", "loginUrl", username, password,
    "activationTemplate", "odooEnabled", "odooUrl", "odooUser", "odooPass", "odooUid"
  FROM towers WHERE id = $1`, [FROM]);
const dst = await one(`SELECT id, name, "agentId", "isDeleted" FROM towers WHERE id = $1`, [INTO]);
if (!src || !dst) { console.error("✗ أحدُ المكتبَين غير موجود"); process.exit(1); }
console.log(`المصدر : ${src.id} · ${src.name} (وكيل ${src.agentId})${src.isDeleted ? " ⚠️ محذوفٌ سلفاً" : ""}`);
console.log(`الهدف  : ${dst.id} · ${dst.name} (وكيل ${dst.agentId})`);

if (src.agentId !== dst.agentId) { console.error("\n🔴 المكتبان لوكيلَين مختلفَين — الدمجُ مرفوضٌ (عزلُ المستأجرين)"); process.exit(1); }
if (!src.loginUrl || !src.username || !src.password) { console.error("\n🔴 المكتبُ المصدرُ بلا بيانات ساس كاملة — لا لوحةَ تُبنى منه"); process.exit(1); }

// ───── ٢) حصّةُ المالك ─────
const ag = await one(`SELECT "multiSasOffices" FROM agents WHERE id = $1`, [src.agentId]);
const usedNow = await q(`SELECT p."towerId" FROM sas_panels p JOIN towers t ON t.id = p."towerId"
  WHERE t."agentId" = $1 AND p."isDeleted" = false GROUP BY 1 HAVING count(*) > 1`, [src.agentId]);
const quota = ag?.multiSasOffices ?? 0;
const willConsume = !usedNow.some((r) => r.towerId === INTO);
console.log(`\nحصّةُ الوكيل: ${quota} · مستهلَكٌ: ${usedNow.length}${willConsume ? " · وهذا الدمجُ يستهلك واحداً" : " · والهدفُ مستهلِكٌ سلفاً"}`);
if (quota === 0 || (willConsume && usedNow.length >= quota)) {
  console.error("\n🔴 الحصّةُ لا تسمح — ارفعها من لوحة المالك («مكاتب بساسين»)");
  process.exit(1);
}

// ───── ٣) 🔴 تصادمُ sasId — أخطرُ ما في الدمج ─────
const clash = await one(`SELECT count(*)::int n FROM (
    SELECT "sasId" FROM subscribers WHERE "towerId" = $1 AND "isDeleted" = false AND "sasId" IS NOT NULL
    INTERSECT
    SELECT "sasId" FROM subscribers WHERE "towerId" = $2 AND "isDeleted" = false AND "sasId" IS NOT NULL) x`, [FROM, INTO]);
console.log(`تصادمُ (المكتب, sasId): ${clash.n} ${clash.n ? "🔴 يمنع الدمج" : "✅"}`);
if (clash.n) {
  console.error("\n🔴 مشتركون بنفس sasId في المكتبَين — القيدُ الفريدُ سيرفض النقل، وحلُّه يدويٌّ قبل الدمج");
  process.exit(1);
}

// ───── ٤) جردُ ما سيُنقل — من كلّ جدولٍ فيه towerId ─────
const tabs = (await q(`SELECT table_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name='towerId' ORDER BY table_name`)).map((r) => r.table_name);
const moving = [];
for (const t of tabs) {
  const r = await one(`SELECT count(*)::int n FROM "${t}" WHERE "towerId" = $1`, [FROM]);
  if (r.n) moving.push({ الجدول: t, صفوف: r.n });
}
console.log(`\nجداولُ فيها towerId: ${tabs.length} · وفيها صفوفٌ للمصدر: ${moving.length}`);
console.table(moving);

// ───── ٥) الباقات: تُطابَق بالاسم فتُدمج، وغيرُ المتطابقة تُنقل كما هي ─────
const pkgs = await q(`SELECT s.id, s.name, d.id AS dst_id
  FROM packages s LEFT JOIN packages d ON d."towerId" = $2 AND d."isDeleted" = false AND lower(btrim(d.name)) = lower(btrim(s.name))
  WHERE s."towerId" = $1 AND s."isDeleted" = false ORDER BY s.id`, [FROM, INTO]);
console.log("\nالباقات:");
for (const p of pkgs) console.log(`  ${p.id} «${p.name}» ← ${p.dst_id ? `تُدمج في ${p.dst_id} (مطابقةُ الاسم)` : "تُنقل كما هي (لا مطابق)"}`);

if (!APPLY) {
  console.log(`\nسيُنفَّذ عند --apply:
  ١) لوحةٌ جديدةٌ على المكتب ${INTO} ببيانات ساس/أودو المكتب ${FROM} (اسمُها «${src.name}»)
  ٢) مشتركو ${FROM} → المكتب ${INTO} ووسمُهم بتلك اللوحة
  ٣) الباقاتُ المتطابقةُ اسماً تُدمج (يُعاد ربطُ مشتركيها) وغيرُها تُنقل
  ٤) بقيّةُ الصفوف (لوحاتُ البطاقات · جلسةُ الواتساب … ) تُنقل أو تُحذف بحسب نوعها
  ٥) المكتب ${FROM} **حذفٌ ناعمٌ** (يبقى بتاريخه)
  والكلُّ في **معاملةٍ واحدة**.\n`);
  await c.end();
  process.exit(0);
}

// ═══════════════════ التنفيذ — معاملةٌ واحدة ═══════════════════
await c.query("BEGIN");
try {
  // (١) اللوحة
  const panel = await one(
    `INSERT INTO sas_panels ("towerId","agentId",label,"sortOrder","isPrimary",
        "loginUrl",username,password,"activationTemplate",
        "odooEnabled","odooUrl","odooUser","odooPass","odooUid")
     VALUES ($1,$2,$3,1,false,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [INTO, dst.agentId, src.name, src.loginUrl, src.username, src.password, src.activationTemplate,
     src.odooEnabled, src.odooUrl, src.odooUser, src.odooPass, src.odooUid],
  );
  console.log(`✓ لوحةٌ جديدة #${panel.id} «${src.name}» على المكتب ${INTO}`);

  // (٢) الباقات: إعادةُ ربطٍ ثمّ حذفٌ ناعم / نقل
  for (const p of pkgs) {
    if (p.dst_id) {
      const r = await c.query(`UPDATE subscribers SET "packageId" = $1 WHERE "packageId" = $2`, [p.dst_id, p.id]);
      await c.query(`UPDATE packages SET "isDeleted" = true WHERE id = $1`, [p.id]);
      console.log(`✓ باقة ${p.id} → ${p.dst_id} (أُعيد ربطُ ${r.rowCount} مشتركاً) ثمّ حذفٌ ناعم`);
    } else {
      await c.query(`UPDATE packages SET "towerId" = $1 WHERE id = $2`, [INTO, p.id]);
      console.log(`✓ باقة ${p.id} نُقلت إلى المكتب ${INTO}`);
    }
  }

  // (٣) المشتركون: نقلٌ ووسمٌ باللوحة
  const subs = await c.query(
    `UPDATE subscribers SET "towerId" = $1, "sasPanelId" = $2 WHERE "towerId" = $3`, [INTO, panel.id, FROM]);
  console.log(`✓ مشتركون نُقلوا ووُسموا باللوحة: ${subs.rowCount}`);

  // (٤) بقيّةُ الجداول: تُنقل كما هي — إلّا ما لا معنى لنقله
  //     `wa_sessions` جلسةُ واتساب المكتب المصدر: تُحذف (المكتبُ الهدفُ له جلستُه، ولا جلستَين لمكتب)
  //     `sas_panels`  لوحاتُ المصدر: تُحذف ناعماً (بياناتُها صارت في اللوحة الجديدة)
  //     `towers`      يُعالَج أدناه
  const SKIP = new Set(["towers", "wa_sessions", "sas_panels", "subscribers", "packages", "task_boards"]);
  for (const { الجدول: t } of moving) {
    if (SKIP.has(t)) continue;
    const r = await c.query(`UPDATE "${t}" SET "towerId" = $1 WHERE "towerId" = $2`, [INTO, FROM]);
    if (r.rowCount) console.log(`✓ ${t}: ${r.rowCount} صفّاً نُقل`);
  }

  // لوحةُ بطاقات المصدر: **الفارغةُ تُحذف ناعماً** (وإلّا صار للمكتب لوحتان فارغتان بالاسم نفسِه)،
  // وذاتُ المحتوى **تُنقل** فلا يضيع منها شيء. والكودُ يقرأ لوحاتِ المكتب بـ`findMany` فيتحمّل أكثرَ من لوحة.
  const boards = await q(
    `SELECT b.id, b.name, (SELECT count(*)::int FROM task_lists l WHERE l."boardId" = b.id) AS lists
     FROM task_boards b WHERE b."towerId" = $1 AND b."isDeleted" = false`, [FROM]);
  for (const b of boards) {
    if (b.lists === 0) {
      await c.query(`UPDATE task_boards SET "isDeleted" = true WHERE id = $1`, [b.id]);
      console.log(`✓ لوحةُ بطاقات #${b.id} «${b.name}» فارغةٌ ⇒ حذفٌ ناعم`);
    } else {
      await c.query(`UPDATE task_boards SET "towerId" = $1 WHERE id = $2`, [INTO, b.id]);
      console.log(`✓ لوحةُ بطاقات #${b.id} «${b.name}» فيها ${b.lists} قائمةً ⇒ نُقلت إلى ${INTO}`);
    }
  }
  const wa = await c.query(`DELETE FROM wa_sessions WHERE "towerId" = $1`, [FROM]);
  if (wa.rowCount) console.log(`✓ جلسةُ واتساب المصدر حُذفت (${wa.rowCount})`);
  const op = await c.query(`UPDATE sas_panels SET "isDeleted" = true WHERE "towerId" = $1`, [FROM]);
  if (op.rowCount) console.log(`✓ لوحاتُ المصدر القديمة حُذفت ناعماً (${op.rowCount})`);

  // (٥) المكتبُ المصدر: حذفٌ ناعمٌ — يبقى بتاريخه ويُمكن الرجوع
  await c.query(`UPDATE towers SET "isDeleted" = true WHERE id = $1`, [FROM]);
  console.log(`✓ المكتب ${FROM} حذفٌ ناعم`);

  await c.query(
    `INSERT INTO audit_logs (action, entity, "entityId", details, "createdAt")
     VALUES ('MERGE_OFFICE_INTO_PANEL', 'tower', $1, $2, now())`,
    [String(FROM), `دمجُ مكتب ${FROM} «${src.name}» في ${INTO} «${dst.name}» كلوحةِ ساس #${panel.id} — ${subs.rowCount} مشتركاً`],
  );

  await c.query("COMMIT");
  console.log("\n✅ المعاملةُ تمّت");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n🔴 فشلٌ — أُرجعت المعاملةُ كلُّها ولم يتغيّر شيء:\n" + String(e.message).slice(0, 400));
  await c.end();
  process.exit(1);
}

// ───── تحقُّقٌ بعد ─────
console.log("\n═══ تحقُّق ═══");
console.table(await q(`SELECT t.id, t.name, t."isDeleted" AS محذوف,
   (SELECT count(*)::int FROM subscribers s WHERE s."towerId"=t.id AND s."isDeleted"=false) AS مشتركون
 FROM towers t WHERE t."agentId" = $1 ORDER BY t.id`, [src.agentId]));
console.table(await q(`SELECT p.id, p."towerId" AS مكتب, p.label, p."isDeleted" AS محذوفة,
   (SELECT count(*)::int FROM subscribers s WHERE s."sasPanelId"=p.id AND s."isDeleted"=false) AS مشتركوها
 FROM sas_panels p WHERE p."towerId" IN (SELECT id FROM towers WHERE "agentId" = $1) ORDER BY p.id`, [src.agentId]));
const left = [];
for (const t of tabs) {
  const r = await one(`SELECT count(*)::int n FROM "${t}" WHERE "towerId" = $1`, [FROM]);
  if (r.n) left.push({ الجدول: t, "صفوفٌ باقية": r.n });
}
console.log(left.length ? "صفوفٌ ما زالت تُشير إلى المصدر (المكتبُ نفسُه متوقَّع):" : "لا صفَّ يُشير إلى المصدر");
if (left.length) console.table(left);
await c.end();
