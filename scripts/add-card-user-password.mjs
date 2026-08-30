import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const has = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='task_cards' AND column_name='userPassword'`);
  if (has.rowCount) {
    console.log("• task_cards.userPassword موجودٌ سابقاً");
  } else {
    await c.query(`ALTER TABLE task_cards ADD COLUMN "userPassword" TEXT`);
    console.log("✅ أُضيف task_cards.userPassword TEXT");
  }

  const rows = (await c.query(
    `SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
      WHERE table_name='task_cards' AND grantee LIKE 'agent%'`)).rows;
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
    if (have.has("userPassword")) continue;
    await c.query(`GRANT ${priv} ("userPassword") ON task_cards TO "${role}"`);
    n++;
  }
  console.log(`• مُنِح ${n} إذنَ عمودٍ لأدوار الوكلاء على userPassword`);

  const blind = await c.query(
    `SELECT DISTINCT g.grantee FROM information_schema.column_privileges g
      WHERE g.table_name='task_cards' AND g.grantee LIKE 'agent%' AND g.privilege_type='SELECT'
        AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges x
          WHERE x.table_name='task_cards' AND x.grantee=g.grantee AND x.privilege_type='SELECT' AND x.column_name='userPassword')`);
  if (blind.rowCount) {
    console.log(`🔴 userPassword أعمى في وجه: ${blind.rows.map((b) => b.grantee).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("🔒 userPassword مرئيٌّ لكلّ دورٍ يقرأ task_cards");
  }
} catch (e) {
  console.error("🔴", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
