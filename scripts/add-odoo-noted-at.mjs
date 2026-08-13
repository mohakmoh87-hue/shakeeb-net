// ===== ب-١/الأصل ٤ · ختمُ الأثر الذي لا يُسترَدّ =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-odoo-noted-at.mjs
//
// 🔴 **العلّةُ**: دفعُ الإنجاز/الإلغاء إلى أودو يحجز البطاقةَ ذرّيّاً (`odooPushedAt`)، ثمّ
//   عند أيّ فشلٍ **يفكُّ الحجزَ** فتُعاد المحاولة. وهذا صحيحٌ للإغلاق (يتحمّل التكرار)
//   لكنّ الترتيبَ: ملاحظةٌ في محادثة العميل ← إغلاق. فإن نجحت الملاحظةُ وفشل الإغلاقُ
//   (أو حتى كتابةُ السجلّ) **أُعيد نشرُ الملاحظة في محادثة العميل كلَّ دورة**.
//
// 🔑 والحلُّ ليس منعَ الإعادة — فيبقى الإغلاقُ معلَّقاً للأبد — بل **ختمُ الأثر وحدَه**:
//   عمودٌ لا يُفَكّ أبداً، فالإعادةُ تُكمل ما بقي ولا تُكرّر ما لا يُسترَدّ.
//
// إضافيٌّ واختياريّ ⇒ نشرةٌ أقدمُ حيّةٌ لا تعرفه ولا تتأثّر به (بريزما تُسمّي أعمدتها
// صريحةً في SELECT). والختمُ **يُملأ للبطاقات المدفوعة سلفاً** بقيمة `odooPushedAt`:
// فتلك ملاحظاتُها نُشرت فعلاً، ولو تُركت `null` لكان أوّلُ فشلٍ لاحقٍ يُعيد نشرَها.

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");

const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }

const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  const before = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='task_cards' AND column_name='odooNotedAt'`,
  );
  if (before.rowCount) {
    console.log("✓ العمودُ موجودٌ سلفاً — لا شيء يُفعَل");
  } else {
    await c.query(`ALTER TABLE task_cards ADD COLUMN "odooNotedAt" TIMESTAMP(3)`);
    console.log('✅ أُضيف العمود "odooNotedAt"');
  }

  // الرجعيّة: ما دُفع سلفاً ملاحظتُه منشورة — فيُختَم بلحظة دفعه.
  const back = await c.query(
    `UPDATE task_cards SET "odooNotedAt" = "odooPushedAt"
      WHERE "odooPushedAt" IS NOT NULL AND "odooNotedAt" IS NULL`,
  );
  console.log(`✅ خُتمت ${back.rowCount} بطاقةً مدفوعةً سلفاً (ملاحظاتُها نُشرت فعلاً)`);

  // العاملُ يقرأ ويكتب هذا العمود ⇒ لا GRANT جديد (صلاحيّةُ الجدول قائمة)، لكن نُبرزها
  const g = await c.query(
    `SELECT grantee, string_agg(privilege_type,',' ORDER BY privilege_type) pr
       FROM information_schema.role_table_grants WHERE table_name='task_cards' GROUP BY grantee ORDER BY grantee`,
  );
  console.log("── صلاحيّاتُ task_cards ──");
  for (const r of g.rows) console.log("  •", r.grantee, "→", r.pr);
  const p = await c.query(`SELECT policyname, cmd FROM pg_policies WHERE tablename='task_cards'`);
  console.log("── سياساتُ العزل ──", p.rows.map((r) => `${r.policyname}[${r.cmd}]`).join(" · ") || "⚠️ لا سياسة!");
} finally {
  await c.end();
}
