// ═════ مسحُ وسومِ «كارتٌ وهميّ» الكاذبة (طلبُ محمد 2026-08-13) ═════
//
// البلاغ: صفحةُ الكروت الوهميّة تُرجع **كروتاً مستخدمةً حقّاً**، وضغطةُ «ربط» تربطها
// بمشتركيها وتزيلها — أي أنّها لم تكن وهميّةً قطّ. تكرّر لأكثرِ من وكيلٍ وحتى شكيب.
//
// 🎯 والبصمةُ مقيسةٌ على الإنتاج: **١١ من ١١** تشغيلاً وسم كروتاً كان فيه «سليم ٠» — لم
//   يُثبِت ولا كارتاً واحداً أنّه حقيقيّ. و٥٥ تشغيلاً سليماً أثبت كروتَه ولم يسم شيئاً.
//   ⇒ «كلُّ كروتِ المكتب وهميّة» خبرٌ عن **مصدرِ الأدلّة** لا عن الكروت.
//   (والمنعُ الدائمُ صار في `runFullCardAudit` — وهذا السكربتُ لأثرِ ما مضى.)
//
// 🔒 وما يمسّه: **سجلُّ التدقيق وحدَه** (`audit_logs` بـ`action='SYNC_PHANTOM_VERIFIED'`).
//    ولا يمسّ كارتاً ولا مالاً ولا ربطاً: الكروتُ مربوطةٌ بمشتركيها سلفاً، والسكربتُ
//    يُثبت ذلك بعدّها **قبل الحذف وبعده** ويرفض الإتمامَ إن تغيّر شيء.
//
// 🧯 والتراجعُ محفوظ: تُكتب نسخةٌ كاملةٌ بكلّ الحقول إلى ملفٍّ قبل أيّ حذف.
//
//   قياسٌ بلا حذف (الافتراض):
//     DATABASE_URL="…?sslmode=no-verify" node scripts/clear-false-phantom-flags.mjs
//   التنفيذُ فعلاً:
//     DATABASE_URL="…?sslmode=no-verify" node scripts/clear-false-phantom-flags.mjs --apply
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const req = createRequire(import.meta.url);
const { Client } = req("pg");

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }

/** أدنى عيّنةٍ تجعل «صفرَ مُثبَتٍ» بصمةَ عطبٍ لا حقيقة — مطابقٌ لِما في runFullCardAudit. */
const MIN_SAMPLE = 3;

const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log(`═══ ${APPLY ? "🗑️ تنفيذٌ فعليّ" : "🔎 قياسٌ بلا حذف"} ═══\n`);

  // ١) التشغيلاتُ التي وسمت، ونتيجةُ كلٍّ منها
  const runs = (await c.query(
    `SELECT "createdAt", details FROM audit_logs WHERE action='SYNC_FULL_CARDS' ORDER BY "createdAt"`,
  )).rows
    .map((r) => {
      const m = /مستخدم (\d+) \(سليم (\d+) · وهمي (\d+)\)/.exec(r.details || "");
      return m ? { at: r.createdAt, used: +m[1], real: +m[2], ph: +m[3] } : null;
    })
    .filter(Boolean).filter((r) => r.ph > 0);
  console.log(`تشغيلاتٌ وسمت كروتاً: ${runs.length}`);
  console.log(`  منها عاطبةٌ (سليم ٠ وعيّنةٌ ≥${MIN_SAMPLE}): ${runs.filter((r) => r.real === 0 && r.used >= MIN_SAMPLE).length}`);

  // ٢) كلُّ وسمٍ يُنسَب لتشغيلِه: أقربُ سجلِّ تشغيلٍ **بعده** خلال ٣٠ دقيقة
  //    (سجلُّ التشغيل يُكتب بعد الحلقة، فهو دائماً لاحقٌ لوسومه)
  const flags = (await c.query(
    `SELECT id, "entityId", "createdAt" FROM audit_logs WHERE action='SYNC_PHANTOM_VERIFIED' ORDER BY "createdAt"`,
  )).rows;
  const doomed = [], kept = [];
  for (const f of flags) {
    const run = runs.find((r) => r.at >= f.createdAt && r.at - f.createdAt < 30 * 60000);
    if (run && run.real === 0 && run.used >= MIN_SAMPLE) doomed.push(f); else kept.push(f);
  }
  console.log(`\nوسومُ «وهمي» كلُّها: ${flags.length}`);
  console.log(`• كاذبةٌ بالبصمة (للمسح): ${doomed.length}`);
  console.log(`• تُترَك (مشكوكةٌ أو بلا تشغيلٍ مُطابق): ${kept.length}`);
  if (!doomed.length) { console.log("\nلا شيءَ للمسح."); process.exit(0); }

  // ٣) توزيعُها على المكاتب — ليراه المالكُ قبل أن يقرّر
  const ids = [...new Set(doomed.map((d) => Number(d.entityId)).filter(Number.isFinite))];
  console.table((await c.query(
    `SELECT ag.name AS "الوكيل", t.name AS "المكتب", count(*)::int AS "كروتٌ وُسِمت ظلماً"
       FROM recharge_cards rc LEFT JOIN subscribers s ON s.id=rc."subscriberId"
       LEFT JOIN towers t ON t.id=s."towerId" LEFT JOIN agents ag ON ag.id=rc."agentId"
      WHERE rc.id = ANY($1::int[]) GROUP BY 1,2 ORDER BY 3 DESC`, [ids])).rows);

  // ٤) حالةُ الكروت قبل — تُقارَن بعدَ الحذف إثباتاً أنّها لم تُمَسّ
  const snap = async () => (await c.query(
    `SELECT count(*)::int AS n, count("useDate")::int AS used, count("subscriberId")::int AS linked
       FROM recharge_cards WHERE id = ANY($1::int[])`, [ids])).rows[0];
  const before = await snap();
  console.log(`\nالكروتُ المعنيّة: ${before.n} · مستخدمة ${before.used} · مربوطةٌ بمشترك ${before.linked}`);

  if (!APPLY) {
    console.log("\n🔎 قياسٌ فقط — لم يُحذَف شيء. للتنفيذ أضِف --apply");
    process.exit(0);
  }

  // ٥) نسخةُ التراجع **قبل** الحذف (بكلّ الحقول لتُستعاد كما كانت)
  const full = (await c.query(
    `SELECT * FROM audit_logs WHERE id = ANY($1::int[])`, [doomed.map((d) => d.id)])).rows;
  const backup = path.join(process.cwd(), `phantom-flags-backup-${full.length}.json`);
  fs.writeFileSync(backup, JSON.stringify(full, null, 1), "utf8");
  console.log(`\n📦 نسخةُ التراجع: ${backup} (${full.length} صفّاً)`);
  if (full.length !== doomed.length) {
    console.log("🔴 النسخةُ ناقصةٌ عن المطلوب — أُوقف بلا حذف");
    process.exit(1);
  }

  // ٦) الحذفُ بالمُعرِّفات حصراً، في معاملةٍ واحدة، ولا يُثبَّت إلّا إن طابق العدد
  await c.query("BEGIN");
  const del = await c.query(
    `DELETE FROM audit_logs WHERE id = ANY($1::int[]) AND action='SYNC_PHANTOM_VERIFIED'`,
    [doomed.map((d) => d.id)]);
  const after = await snap();
  const cardsUntouched = before.n === after.n && before.used === after.used && before.linked === after.linked;
  if (del.rowCount !== doomed.length || !cardsUntouched) {
    await c.query("ROLLBACK");
    console.log(`🔴 حُذف ${del.rowCount} من ${doomed.length}${cardsUntouched ? "" : " · والكروتُ تغيّرت"} — أُلغيت المعاملة ولم يتغيّر شيء`);
    process.exit(1);
  }
  await c.query("COMMIT");
  console.log(`\n🗑️ حُذف ${del.rowCount} وسماً كاذباً`);
  console.log(`✅ والكروتُ لم تُمَسّ: ${after.n} · مستخدمة ${after.used} · مربوطة ${after.linked}`);
  const left = (await c.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='SYNC_PHANTOM_VERIFIED'`)).rows[0].n;
  console.log(`وسومُ «وهمي» الباقية: ${left} (المتوقَّع ${kept.length})`);
} catch (e) {
  console.error("🔴", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
