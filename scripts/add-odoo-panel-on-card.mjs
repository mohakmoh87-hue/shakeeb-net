// ===== أ-٢٣ · لوحةُ أودو على بطاقة التذكرة (يمنع التنفيذَ المزدوج) =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-odoo-panel-on-card.mjs
//
// 🔴 **العلّةُ التي يمنعها**: الدفعُ إلى أودو وفحصُ المهلة يبحثان في بطاقاتِ **المكتب**. فلمّا
// صار للمكتب حسابا أودو (لوحتان)، تُعامَل كلُّ بطاقةٍ **مرّتَين**: إنذارٌ للفنيّ مرّتَين،
// و**رسالةُ واتسابٍ للمشترك مرّتَين**، ومحاولةُ دفعٍ بحسابٍ لا تنتمي إليه التذكرة.
// و«الشدن» إرسالُه التلقائيُّ **مُشعَلٌ فعلاً** (٩٠ دقيقة) — فالضررُ كان سيصل المشتركين.
// ⇒ تحمل البطاقةُ لوحتَها، وكلُّ حسابٍ يعمل على تذاكره وحدَها.
//
// 📌 وتبقى البطاقةُ على **لوحةِ مكتبٍ واحدة** فتظهر التذاكرُ كلُّها معاً في صفحةٍ واحدة —
//    شرطُ محمد: «تظهر التذاكرُ كلُّها معاً بصفحة إدارة فنيّين واحدة».
//
// ✅ ولا هجرةَ بيانات: الصفوفُ القائمةُ تبقى `NULL` = «أودو المكتب» — **وهو صحيحٌ لأنّ كلَّ
//    بطاقةٍ قائمةٍ جاءت من حساب المكتب** (لا لوحةَ لها حسابُ أودو اليوم: صفر).
//
// ⚠️ يُشغَّل قبل النشر. idempotent.
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const c = new Client({ connectionString: url });

async function main() {
  await c.connect();
  const q = async (s, p = []) => (await c.query(s, p)).rows;

  const [{ exists }] = await q(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='task_cards' AND column_name='odooPanelId') AS exists`);
  if (exists) {
    console.log("ℹ️  العمودُ موجودٌ مسبقاً");
  } else {
    await c.query(`ALTER TABLE task_cards ADD COLUMN "odooPanelId" integer`);
    await c.query(`CREATE INDEX IF NOT EXISTS "task_cards_odooPanelId_idx" ON task_cards ("odooPanelId")`);
    console.log("✅ أُضيف العمود + فهرسُه على task_cards");
  }

  const g = await q(`
    SELECT DISTINCT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_name='task_cards' AND grantee <> current_user ORDER BY 1,2`);
  console.log(`\n— صلاحيّاتُ task_cards: ${g.length ? g.map((x) => `${x.grantee}/${x.privilege_type}`).join(" · ") : "(المالكُ وحده)"}`);

  const [n] = await q(`
    SELECT count(*) FILTER (WHERE "viaOdoo")::int AS odoo_cards,
           (SELECT count(*)::int FROM sas_panels WHERE "isDeleted"=false AND "isPrimary"=false AND "odooUser" IS NOT NULL) AS panels_with_odoo
    FROM task_cards`);
  console.log(`— بطاقاتُ أودو القائمة: ${n.odoo_cards} (كلُّها NULL = أودو المكتب · وهو صحيح)`);
  console.log(`— لوحاتٌ غيرُ أولى لها حسابُ أودو: ${n.panels_with_odoo}`);
  if (n.panels_with_odoo === 0) console.log("  ✅ فلا وحدةَ ثانيةً بعد ⇒ لا تنفيذَ مزدوجاً وقع، والبابُ صار آمناً قبل أن تُضبَط");

  await c.end();
}

main().catch(async (e) => { console.error("🔴", e.message); await c.end().catch(() => {}); process.exit(1); });
