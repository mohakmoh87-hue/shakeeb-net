// ===== أ-١٥ · فهرسٌ فريدٌ جزئيٌّ على odooTicketId — بطاقتان لتذكرةٍ مستحيلتان =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-odoo-ticket-unique.mjs
//
// 🔴 `odooTicketId` كان فهرساً عاديّاً، والإنشاءُ «فحصٌ ثمّ كتابة» بلا معاملة ⇒ حاسبتان
//   تسحبان معاً تُنشئ كلٌّ بطاقتَها للتذكرة نفسِها — وإنجازُ إحداهما يُنجز الأخرى عبر
//   المصالحة (عينُ ما نهى عنه محمد في أ-١٥).
// ⇒ فهرسٌ فريدٌ **جزئيّ** (حيث isDeleted=false): الجزئيّةُ لازمةٌ لأنّ إعادةَ الإنشاء بعد
//   الحذف الناعم مقصودةٌ بطلبه (السحبُ يُعيد ما حُذف وتذكرتُه مفتوحة). والكودُ يلتقط P2002
//   فيُعيد البطاقةَ القائمة. إضافيٌّ خالص ⇒ نشرةٌ أقدمُ حيّةٌ لا تتأثّر.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  // ١) لا فهرسَ فوق تكرارٍ قائم — يُفحَص أوّلاً ويُعرَض ليُحسَم يدويّاً (لا حذفَ تلقائيّاً لبطاقة!)
  const dup = await c.query(`
    SELECT "odooTicketId", array_agg(id ORDER BY id) ids, COUNT(*) n
      FROM task_cards WHERE "odooTicketId" IS NOT NULL AND "isDeleted" = false
     GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY n DESC`);
  if (dup.rowCount) {
    console.log(`🔴 ${dup.rowCount} تذكرةً لها أكثرُ من بطاقةٍ حيّة — يُحسَم يدويّاً قبل الفهرس:`);
    for (const r of dup.rows) console.log(`  • تذكرة #${r.odooTicketId}: بطاقات ${r.ids.join(", ")}`);
    console.log("⛔ لم يُنشأ الفهرس. احسم التكرارات (احذف الزائدة ناعماً) ثم أعد التشغيل.");
    process.exit(2);
  }
  console.log("✓ لا تكرارَ حيّاً — الطريق سالك");

  // ٢) الفهرس الفريد الجزئيّ — idempotent
  const has = await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'task_cards_odoo_ticket_live_unique'`);
  if (has.rowCount) console.log("✓ الفهرس موجودٌ سلفاً");
  else {
    await c.query(`CREATE UNIQUE INDEX task_cards_odoo_ticket_live_unique
      ON task_cards ("odooTicketId") WHERE "odooTicketId" IS NOT NULL AND "isDeleted" = false`);
    console.log("✅ أُنشئ الفهرس task_cards_odoo_ticket_live_unique");
  }
} finally { await c.end(); }
