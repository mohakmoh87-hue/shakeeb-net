// فحص قاعدة البيانات القديمة MyNetData.db3: الجداول، الأعمدة، عدد السجلات، وعيّنة
import Database from "better-sqlite3";

const path = process.env.LEGACY_DB_PATH || "D:/MyNet.v4/Data/MyNetData.db3";
const db = new Database(path, { readonly: true, fileMustExist: true });

const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all();

for (const { name } of tables) {
  let count = "?";
  try {
    count = db.prepare(`SELECT COUNT(*) c FROM "${name}"`).get().c;
  } catch {}
  const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
  console.log(`\n### ${name}  (${count} صف)`);
  console.log(
    cols.map((c) => `${c.name}:${c.type || "?"}${c.pk ? " PK" : ""}`).join(" | "),
  );
}

db.close();
