// ===== البند ٧ · ختمُ رسالة «رُفعت لك بطاقة» (طلبُ محمد 2026-08-13) =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-card-raised-notice.mjs
//
// 🔴 **الختمُ هو كلُّ الأمان**: أودو تُنشئ البطاقاتَ بمسحٍ شاملٍ **كلَّ دورة**، و**تُعيد
//   إنشاءَ بطاقةٍ حُذفت وتذكرتُها ما زالت مفتوحة**. فبلا ختمٍ تُرسَل الرسالةُ للمشترك كلَّ
//   دورةٍ إلى الأبد — وهي عينُ حادثة تكرار رسائل الشدن (٤ نسخٍ لكلّ مشترك).
// و`raisedNoticeAt` يُختَم **قبل** الإرسال حَجزاً ذرّيّاً (`updateMany` بشرط `null`).
//
// 🔑 **ويُردَم للبطاقات القائمة**: كلُّ بطاقةٍ موجودةٍ الآن تُعتبَر «أُبلِغ عنها» — وإلّا
//   لَأرسل أوّلُ تشغيلٍ رسالةً لكلّ مشتركٍ له بطاقةٌ مفتوحةٌ في النظام كلِّه دفعةً واحدة.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const has = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='task_cards' AND column_name='raisedNoticeAt'`,
  );
  if (has.rowCount) console.log("✓ العمودُ موجودٌ سلفاً");
  else { await c.query(`ALTER TABLE task_cards ADD COLUMN "raisedNoticeAt" TIMESTAMP(3)`); console.log('✅ أُضيف "raisedNoticeAt"'); }

  // ⚠️ الردمُ الوقائيّ: كلُّ بطاقةٍ قائمةٍ تُختَم بوقت إنشائها ⇒ لا رسائلَ رجعيّة
  const back = await c.query(
    `UPDATE task_cards SET "raisedNoticeAt" = COALESCE("createdAt", NOW()) WHERE "raisedNoticeAt" IS NULL`,
  );
  console.log(`✅ خُتمت ${back.rowCount} بطاقةً قائمةً ⇒ **صفرُ رسائلَ رجعيّة** لحظةَ النشر`);

  const g = await c.query(
    `SELECT grantee, string_agg(privilege_type,',' ORDER BY privilege_type) pr
       FROM information_schema.role_table_grants WHERE table_name='task_cards' GROUP BY grantee ORDER BY grantee`,
  );
  for (const r of g.rows) console.log("  • GRANT", r.grantee, "→", r.pr);
  const tw = await c.query(
    `SELECT 1 FROM information_schema.role_table_grants
      WHERE table_name='task_cards' AND grantee='agent_worker' AND privilege_type='UPDATE'`,
  );
  console.log(tw.rowCount
    ? "✓ للعامل UPDATE على task_cards ⇒ يكتب الختمَ (أودو تعمل عليه)"
    : "⚠️ لا UPDATE للعامل على task_cards — راجِعْ قبل النشر!");
} finally { await c.end(); }
