// ===== ب-١/الأصل ١ · صلاحيّةُ العامل على أعمدةِ الإجارة (وأعمدتِها وحدَها) =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/grant-agent-lease-cols.mjs
//
// 🔴 قياسٌ حيٌّ كشف أنّ `agent_1_worker` **يقرأ `agents` ولا يكتبه** («permission denied
//   for table agents»). ونتيجتان:
//   ١) إجارةُ القيادة الجديدةُ (`UPDATE agents SET leaderMachineId…`) كانت **ستُعطّل
//      القيادةَ كلَّها** على حاسبات المكاتب: لا واتساب، ولا مزامنةَ أودو، ولا مهامَّ قائد.
//   ٢) وختمُ `lastBackupDate` في `runDailyBackups` **كان يفشل صامتاً** على العامل
//      (`.catch(() => {})`) — والنسخُ تُختَم فعلاً من كرونِ السحابة بدورِ المالك.
//
// ⇒ القاعدةُ الذهبيّة: **كلُّ كتابةٍ جديدةٍ = GRANT + سياسة**. وهنا:
//   · GRANT **محصورٌ بالأعمدة الثلاثة** — فالعاملُ لا يستطيع لمسَ حصصِ الوكيل ولا
//     تاريخِ انتهاء خطّته ولا بريدِ نسخِه. (بوستغريس يدعم GRANT على أعمدةٍ بعينها.)
//   · وسياسةُ UPDATE مقيَّدةٌ بـ`id = current_agent_id()` في `USING` **و`WITH CHECK`**:
//     الأولى تمنع رؤيةَ صفوفِ غيره، والثانيةُ تمنعه من **تحويل** صفّه إلى وكيلٍ آخر.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  // 🔴 **و`SELECT` قبل `UPDATE`**: دورُ العامل يملك SELECT على **أعمدةٍ بعينها** لا على
  //   الجدول (١٢ عموداً قِيست)، فالعمودان الجديدان خارجَها — وكلُّ استعلامِ إجارةٍ يذكرهما
  //   في `WHERE`. فبلا هذا السطر يرمي «permission denied» فتموت القيادةُ على كلّ الحاسبات
  //   (وقع فعلاً ساعةً وربعاً في 2026-08-13). و`lastBackupDate` لم يكن مقروءاً أصلاً ⇒ نسخُ
  //   `runDailyBackups` على العامل كانت **تفشل قبل هذا البند** والسحابةُ وحدَها تنسخ.
  await c.query(`GRANT SELECT ("leaderMachineId", "leaderUntil", "lastBackupDate") ON agents TO agent_worker`);
  console.log("✅ GRANT SELECT على الأعمدة الثلاثة (بلاه يرمي permission denied في WHERE)");
  await c.query(`GRANT UPDATE ("leaderMachineId", "leaderUntil", "lastBackupDate") ON agents TO agent_worker`);
  console.log("✅ GRANT UPDATE على ٣ أعمدةٍ فقط لـagent_worker");

  const has = await c.query(`SELECT 1 FROM pg_policies WHERE tablename='agents' AND policyname='rls_agents_update'`);
  if (has.rowCount) console.log("✓ سياسةُ UPDATE موجودةٌ سلفاً");
  else {
    await c.query(`CREATE POLICY rls_agents_update ON agents FOR UPDATE
                     USING (id = current_agent_id()) WITH CHECK (id = current_agent_id())`);
    console.log("✅ أُنشئت سياسة rls_agents_update (صفُّ الوكيل نفسِه حصراً)");
  }

  const p = await c.query(`SELECT policyname, cmd FROM pg_policies WHERE tablename='agents' ORDER BY policyname`);
  console.log("── سياساتُ agents ──", p.rows.map((r) => `${r.policyname}[${r.cmd}]`).join(" · "));
  const g = await c.query(
    `SELECT grantee, column_name FROM information_schema.column_privileges
      WHERE table_name='agents' AND privilege_type='UPDATE' AND grantee <> 'postgres' ORDER BY grantee, column_name`,
  );
  console.log("── أعمدةٌ يكتبها غيرُ المالك ──",
    g.rows.map((r) => `${r.grantee}.${r.column_name}`).join(" · ") || "لا شيء");
} finally { await c.end(); }
