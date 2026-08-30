import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const has = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='subscribers' AND column_name='transferredFrom'`);
  if (has.rowCount) {
    console.log("• subscribers.transferredFrom موجودٌ سابقاً");
  } else {
    await c.query(`ALTER TABLE subscribers ADD COLUMN "transferredFrom" TEXT`);
    console.log("✅ أُضيف subscribers.transferredFrom TEXT");
  }

  const rows = (await c.query(
    `SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
      WHERE table_name='subscribers' AND grantee LIKE 'agent%'`)).rows;
  const byRole = new Map();
  for (const r of rows) {
    const k = `${r.grantee}|${r.privilege_type}`;
    if (!byRole.has(k)) byRole.set(k, new Set());
    byRole.get(k).add(r.column_name);
  }
  let n = 0;
  for (const [k, have] of byRole) {
    const [role, priv] = k.split("|");
    if (!["SELECT", "UPDATE", "INSERT"].includes(priv)) continue;
    if (have.has("transferredFrom")) continue;
    await c.query(`GRANT ${priv} ("transferredFrom") ON subscribers TO "${role}"`);
    n++;
  }
  console.log(`• مُنِح ${n} إذنَ عمودٍ لأدوار الوكلاء على transferredFrom`);

  const blind = await c.query(
    `SELECT DISTINCT g.grantee FROM information_schema.column_privileges g
      WHERE g.table_name='subscribers' AND g.grantee LIKE 'agent%' AND g.privilege_type='SELECT'
        AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges x
          WHERE x.table_name='subscribers' AND x.grantee=g.grantee AND x.privilege_type='SELECT' AND x.column_name='transferredFrom')`);
  if (blind.rowCount) {
    console.log(`🔴 transferredFrom أعمى في وجه: ${blind.rows.map((b) => b.grantee).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("🔒 transferredFrom مرئيٌّ لكلّ دورٍ يقرأ subscribers");
  }
} catch (e) {
  console.error("🔴", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
