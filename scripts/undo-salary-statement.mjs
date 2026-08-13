// ===== التراجعُ عن تسديدِ راتبٍ — إرجاعٌ عكسيٌّ كاملٌ من لقطة الكشف =====
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/undo-salary-statement.mjs 18            ← عرضٌ فقط
//   DATABASE_URL="…" node scripts/undo-salary-statement.mjs 18 --apply                      ← تنفيذ
//
// 🔴 **العلّةُ التي يُعالجها**: تسديدُ الراتب (`api/field/salary`) **يحذف حذفاً نهائيّاً**
// (`deleteMany`) بصماتَ الحضور والخصوماتَ والإجازاتِ في الفترة. فزرُّ «إلغاء الكشف» يُعلِّم
// الكشفَ ملغىً **ولا يُرجع شيئاً** — لأنّ ما يُرجَع محذوفٌ فعلاً. (بلاغُ محمد 2026-08-13:
// «سدّد المديرُ عمر راتبَ أحمد عبد الرزاق خطأً، فألغاه فظهر ملغىً ولم ترجع لا بصماتُه ولا
//  راتبُه ولا ما سحبه».)
//
// 🔑 والمُنقِذُ أنّ الكشفَ يحفظ **لقطةً** (`details` v:2) فيها `dayDetails` و`items` — فمنها
// يُعاد البناء. وحدودُ ما تحفظه اللقطةُ صريحةٌ ولا تُخفى:
//   · تحفظ: **يومَ** كلّ بصمةٍ ومبلغَه وملاحظتَه (بصمةٌ سليمة / إجازةٌ براتب / خصم…)
//   · **لا تحفظ**: أوقاتَ الدخول والخروج الحقيقيّة.
// ⇒ ويومٌ ملاحظتُه «بصمةٌ سليمة» ومبلغُه = المبلغُ اليوميُّ كاملاً يعني **صفرَ تأخيرٍ وصفرَ
//   خروجٍ مبكّرٍ وصفرَ إضافيّ** ⇒ فإعادتُه بدوامه المسجَّل (`shiftStart` → `shiftEnd`) تُنتج
//   **نفسَ الراتب حرفيّاً**. والوقتُ المُعاد يُوسَم `checkoutBy='restored'` فلا يُظنّ بصمةً
//   حقيقيّة — **ولا تُلفَّق بصمةٌ بلا وسم**.
//
// وما يفعله السكربت:
//   (١) يفكّ وسمَ `salaryStatementId` عن حركات حساب الموظف ⇒ سحوباتُه تُحتسَب من جديد
//   (٢) يُعيد بصماتِ الأيّام «السليمة» بدوامه، والإجازاتِ المدفوعةَ كإجازاتٍ معتمَدة
//   (٣) يُبطل قيدَ الصرف إن وُجد (لا يُحذف — إبطالٌ ناعمٌ يُقرأ في السجلّ)
//   (٤) يحذف الكشفَ فتعود الفترةُ مفتوحةً و`carryOut` لا يسري
//   (٥) يكتب سجلَّ تدقيقٍ بكلّ ما فعل
// كلُّه في **معاملةٍ واحدة**: إمّا تمّ كلُّه أو لم يقع شيء.
import { Client } from "pg";

const id = Number(process.argv[2]);
const APPLY = process.argv.includes("--apply");
if (!Number.isInteger(id)) { console.error("مرِّر رقمَ الكشف: node scripts/undo-salary-statement.mjs <id> [--apply]"); process.exit(1); }
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const c = new Client({ connectionString: url });

/** لحظةُ UTC لدقيقةٍ من يومِ بغداد */
const bgTime = (dayKey, hhmm) => {
  const [h, m] = String(hhmm ?? "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return new Date(`${dayKey}T00:00:00+03:00`).getTime() + (h * 60 + m) * 60000;
};

async function main() {
  await c.connect();

  const st = (await c.query(`
    SELECT s.*, t."shiftStart", t."shiftEnd", t."accountId", t.name AS tname
    FROM salary_statements s JOIN technicians t ON t.id = s."technicianId"
    WHERE s.id = $1`, [id])).rows[0];
  if (!st) { console.error(`لا كشفَ بالرقم ${id}`); process.exit(1); }

  const snap = JSON.parse(st.details || "{}");
  const days = snap.dayDetails ?? [];
  const items = snap.items ?? [];
  const stamped = (await c.query(`SELECT id, "moneyIn", "moneyOut" FROM money_tx WHERE "salaryStatementId" = $1`, [id])).rows;

  // ما يُعاد بناؤه
  const clean = days.filter((d) => /سليم/.test(d.note ?? ""));
  const leaves = days.filter((d) => /إجاز|اجاز/.test(d.note ?? ""));
  const other = days.filter((d) => !clean.includes(d) && !leaves.includes(d));

  console.log(`\n═══ الكشف #${id} · ${st.tname} · ${st.periodFrom} → ${st.periodTo} ═══`);
  console.log(`سدّده: ${st.paidByUser} · الصافي ${Number(st.net)} · المدفوع ${Number(st.paidAmount ?? 0)} · المُرحَّل ${Number(st.carryOut ?? 0)}`);
  console.log(`قيدُ الصرف: ${st.moneyTxId ?? "لا شيء (الصافي سالبٌ فلم يُدفَع مال)"}`);
  console.log(`\n— يُعاد: ${clean.length} بصمةً سليمةً بدوامه ${st.shiftStart}→${st.shiftEnd}`);
  for (const d of clean) console.log(`    ${d.date}  (${d.amount})`);
  console.log(`— ويُعاد: ${leaves.length} إجازةً براتب`);
  for (const d of leaves) console.log(`    ${d.date}  ${d.note}`);
  if (other.length) {
    console.log(`— ⚠️ ${other.length} يوماً لا يُعاد آليّاً (ملاحظتُه ليست «سليمة» ولا إجازة) — تُراجَع يدويّاً:`);
    for (const d of other) console.log(`    ${d.date}  ${d.note}  (${d.amount})`);
  }
  console.log(`— ويُفَكُّ وسمُ ${stamped.length} حركةَ حساب موظّف (سحوباتٌ ومقبوضات) فتُحتسَب من جديد:`);
  for (const m of stamped) console.log(`    #${m.id}  قبض ${Number(m.moneyIn ?? 0)} · صرف ${Number(m.moneyOut ?? 0)}`);
  const adv = items.filter((i) => i.type === "advance");
  console.log(`  (واللقطةُ تذكر ${adv.length} سحباً بمجموع ${adv.reduce((s, i) => s + Math.abs(i.amount ?? 0), 0)})`);

  if (!APPLY) { console.log("\n(عرضٌ فقط — أضِف --apply للتنفيذ)"); await c.end(); return; }

  await c.query("BEGIN");
  try {
    // (١) فكُّ الوسم
    const un = await c.query(`UPDATE money_tx SET "salaryStatementId" = NULL WHERE "salaryStatementId" = $1`, [id]);

    // (٢) إعادةُ البصمات السليمة
    let att = 0;
    for (const d of clean) {
      const ci = bgTime(d.date, st.shiftStart), co = bgTime(d.date, st.shiftEnd);
      if (ci == null || co == null) { console.log(`   ⚠️ ${d.date}: لا دوامَ مسجَّلٌ فلا تُعاد بصمتُه`); continue; }
      const r = await c.query(`
        INSERT INTO attendances ("technicianId","agentId","towerId","dayKey","checkIn","checkOut","checkoutBy","updatedAt")
        VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0),to_timestamp($6/1000.0),'restored',now())
        ON CONFLICT ("technicianId","dayKey") DO NOTHING`,
        [st.technicianId, st.agentId, st.towerId, d.date, ci, co]);
      att += r.rowCount;
    }

    // (٣) إعادةُ الإجازات المدفوعة
    let lv = 0;
    for (const d of leaves) {
      const it = items.find((i) => i.date === d.date && /leave/.test(i.type ?? ""));
      const r = await c.query(`
        INSERT INTO leaves ("technicianId","agentId","towerId","dayKey",kind,paid,status,reason,"updatedAt")
        VALUES ($1,$2,$3,$4,'day',true,'approved',$5,now())
        ON CONFLICT DO NOTHING`,
        [st.technicianId, st.agentId, st.towerId, d.date, it?.reason ?? "أُعيدت بالتراجع عن تسديد الراتب"]);
      lv += r.rowCount;
    }

    // (٤) إبطالُ قيد الصرف إن وُجد
    let voided = 0;
    if (st.moneyTxId) {
      const r = await c.query(`UPDATE money_tx SET "isDeleted" = true WHERE id = $1 AND "isDeleted" = false`, [st.moneyTxId]);
      voided = r.rowCount;
    }

    // (٥) حذفُ الكشف — فتعود الفترةُ مفتوحةً ولا يسري `carryOut`
    await c.query(`DELETE FROM salary_statements WHERE id = $1`, [id]);

    await c.query(`
      INSERT INTO audit_logs (action, entity, "entityId", details, "createdAt")
      VALUES ('UNDO_SALARY','salaryStatement',$1,$2,now())`,
      [String(id), `تراجعٌ عن تسديد راتب ${st.tname} (${st.periodFrom} → ${st.periodTo}) الذي سدّده ${st.paidByUser}`
        + ` — فُكَّ وسمُ ${un.rowCount} حركةً · أُعيدت ${att} بصمةً (موسومةً restored) و${lv} إجازةً`
        + ` · أُبطل ${voided} قيدَ صرف · حُذف الكشف`
        + (other.length ? ` · ⚠️ ${other.length} يوماً لم يُعَد آليّاً` : "")]);

    await c.query("COMMIT");
    console.log(`\n✅ تمّ: فُكَّ وسمُ ${un.rowCount} حركةً · أُعيدت ${att} بصمةً و${lv} إجازةً · أُبطل ${voided} قيدَ صرف · حُذف الكشف #${id}`);
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("🔴 أُرجعت المعاملةُ — لم يقع شيء:", e.message);
    process.exit(1);
  }
  await c.end();
}

main().catch(async (e) => { console.error("🔴", e.message); await c.end().catch(() => {}); process.exit(1); });
