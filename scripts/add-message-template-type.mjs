// ===== عمود templateType على messages — صورةُ القالب ترافق البثَّ المصطفّ =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-message-template-type.mjs
//
// إضافيٌّ خالص: الساحبُ يقرؤه ليُرفق صورةَ القالب لحظةَ الإرسال — والصورةُ نفسُها لا
// تُخزَّن في الرسائل أبداً (قرار محمد: «الصور تُغلي الفاتورة»). نشرةٌ أقدمُ لا تتأثّر.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const has = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='templateType'`,
  );
  if (has.rowCount) console.log("✓ templateType موجودٌ سلفاً");
  else { await c.query(`ALTER TABLE messages ADD COLUMN "templateType" TEXT`); console.log("✅ أُضيف templateType"); }
} finally { await c.end(); }
