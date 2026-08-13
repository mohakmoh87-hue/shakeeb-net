// ===== مديرٌ بصلاحيّاتٍ محدَّدة (طلبُ محمد 2026-08-13) =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-denied-permissions.mjs
//
// «أستطيع إضافةَ مديرٍ يأخذ كلَّ ميزات المدير ويرى كلَّ المكاتب، ولكن أمنعُ عنه أيَّ
//  صلاحيّةٍ أريد». وكان `rbac.can` يردّ `true` للمدير قبل أيّ فحصٍ (السطر ١٥٣).
//
// 🔑 **قائمةُ منعٍ لا قائمةَ سماح**: فارغةٌ افتراضاً ⇒ **صفرُ أثرٍ على كلّ مديرٍ قائم**.
//   ولو كانت سماحاً لَلزم تعدادُ كلّ صلاحيّةٍ لكلّ مدير ⇒ أوّلُ نشرةٍ تسلبهم صلاحيّاتِهم.
// إضافيٌّ واختياريّ ⇒ نشرةٌ أقدمُ حيّةٌ لا تعرفه ولا تتأثّر.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const has = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='deniedPermissions'`,
  );
  if (has.rowCount) console.log("✓ العمودُ موجودٌ سلفاً");
  else { await c.query(`ALTER TABLE users ADD COLUMN "deniedPermissions" TEXT`); console.log('✅ أُضيف "deniedPermissions"'); }

  const tw = await c.query(
    `SELECT 1 FROM information_schema.role_table_grants
      WHERE table_name='users' AND grantee='agent_worker' AND privilege_type='SELECT'`,
  );
  const cols = await c.query(
    `SELECT COUNT(*) n FROM information_schema.column_privileges
      WHERE table_name='users' AND grantee='agent_worker' AND privilege_type='SELECT'`,
  );
  if (tw.rowCount) console.log("✓ للعامل SELECT على جدول users كلِّه ⇒ العمودُ مشمول");
  else if (Number(cols.rows[0].n) > 0) {
    await c.query(`GRANT SELECT ("deniedPermissions") ON users TO agent_worker`);
    console.log("✅ GRANT SELECT على العمود (الصلاحيّةُ بالأعمدة لا بالجدول)");
  } else console.log("ℹ️ لا SELECT للعامل على users — لا شيءَ يُمنَح");

  const n = await c.query(`SELECT COUNT(*) n FROM users WHERE "isAdmin"=true AND "isDeleted"=false`);
  console.log(`── مدراءُ النظام: ${n.rows[0].n} — كلُّهم بقائمةِ منعٍ فارغةٍ ⇒ لا تغيُّرَ في صلاحيّاتهم`);
} finally { await c.end(); }
