// ===== هجرة: مهلة سوبر سيل (SLA) لتذاكر أودو =====
// كلّ الأعمدة nullable أو بافتراضيّ ⇒ آمنة تماماً، بلا توقّف وبلا أثرٍ على بياناتٍ قائمة.
// يُنفَّذ مرّةً واحدة على قاعدة الإنتاج قبل نشر الكود (الكود يقرأ هذه الأعمدة).
//
//   DATABASE_URL="postgres://…"  node scripts/add-odoo-sla.mjs
//
// ملاحظة: prisma/rls/*.sql لا تُطبَّق بالنشر (تُنفَّذ يدويّاً) — لذلك سياسة messages هنا أيضاً.
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

// (١) أعمدة البطاقة: مرجع العدّاد وطوابع الإبلاغ وطابور رسالة المشترك
const cardCols = [
  ['"odooCreatedAt"', "timestamp(3)"], // زمن التذكرة في أودو (create_date مُطبَّعاً UTC)
  ['"odooFetchedAt"', "timestamp(3)"], // لحظة سحبها عندنا (مهلة الرؤية + بوّابة التسليح)
  ['"odooPhone"', "text"], // هاتف التذكرة عموداً صريحاً (لا استخراجاً نصّيّاً)
  ['"slaClaimedAt"', "timestamp(3)"], // حجزٌ ذرّيّ قبل الإرسال (منع الإرسال المزدوج)
  ['"slaNoteAt"', "timestamp(3)"], // نجاح ملاحظة التأجيل في أودو ⇒ خروجٌ من المهلة
  ['"slaWaQueuedAt"', "timestamp(3)"], // رسالة المشترك في الطابور
  ['"slaWaSentAt"', "timestamp(3)"], // أُرسلت
  ['"slaWaError"', "text"], // سبب آخر فشل / أُلغيت بعد يوم
];
// (٢) إعدادات المكتب: المفتاح والتسليح والعتبتان والنصّان
const towerCols = [
  ['"odooSlaAuto"', "text DEFAULT '0'"],
  ['"odooSlaArmedAt"', "timestamp(3)"],
  ['"odooSlaAlarmMin"', "integer"],
  ['"odooSlaSendMin"', "integer"],
  ['"odooSlaNote"', "text"],
  ['"odooSlaWaText"', "text"],
];
for (const [col, type] of cardCols) await c.query(`ALTER TABLE task_cards ADD COLUMN IF NOT EXISTS ${col} ${type}`);
for (const [col, type] of towerCols) await c.query(`ALTER TABLE towers ADD COLUMN IF NOT EXISTS ${col} ${type}`);

// (٣) سياسة سجلّ الرسائل: هاتف تذكرة سوبر سيل قد لا يطابق أيّ مشترك عندنا (صيغةٌ مختلفة أو
// تذكرة Change Team لغير مشتركينا)، فيُقبَل صفّ السجلّ إن كان موسوماً بوكيل الحاسبة صريحاً.
// القراءة تبقى معزولةً بالوكيل نفسه (USING بلا تغيير) — والصفّ سجلٌّ بعديّ لا يُرسل شيئاً.
const scope = `
    ("subscriberId" IS NOT NULL AND "subscriberId" IN
       (SELECT s.id FROM subscribers s JOIN towers t ON t.id = s."towerId" WHERE t."agentId" = current_agent_id()))
    OR (phone IS NOT NULL AND phone IN (SELECT agent_notify_phones()))
    OR (phone IS NOT NULL AND phone IN
       (SELECT s.phone FROM subscribers s JOIN towers t ON t.id = s."towerId"
         WHERE t."agentId" = current_agent_id() AND s.phone IS NOT NULL))`;
await c.query(`DROP POLICY IF EXISTS rls_messages ON messages`);
await c.query(`
  CREATE POLICY rls_messages ON messages TO agent_worker
    USING (${scope})
    WITH CHECK (${scope}
      OR (phone IS NOT NULL AND "agentId" IS NOT NULL AND "agentId" = current_agent_id()))`);

// (٤) تحقّق
const q = await c.query(`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE (table_name = 'task_cards' AND (column_name LIKE 'sla%' OR column_name IN ('odooCreatedAt','odooFetchedAt','odooPhone')))
     OR (table_name = 'towers' AND column_name LIKE 'odooSla%')
  ORDER BY table_name, column_name`);
console.log(`أعمدة مُطبَّقة: ${q.rows.length}/14`);
for (const r of q.rows) console.log("  ", `${r.table_name}.${r.column_name}`);
const p = await c.query(`SELECT polname FROM pg_policy WHERE polname = 'rls_messages'`);
console.log("سياسة rls_messages:", p.rows.length ? "موجودة ✅" : "مفقودة ❌");
await c.end();
