// ═════ البند ٤-أ · «المنتهون منذ N يوم» (طلبُ محمد 2026-08-13) ═════
//
//   DATABASE_URL="…?sslmode=no-verify" node scripts/add-expired-notice.mjs
//
// 🔴 **وأخطرُ ما في هذا البند الردمُ لا الأعمدة.** فالاختيارُ يقع على مَن `expiredNoticeAt`
//   فارغةٌ عنده — وهي فارغةٌ عند **كلّ مشتركٍ في القاعدة** لحظةَ إضافة العمود. فلولا
//   الردمُ لَأرسل أوّلُ تشغيلٍ رسالةً لكلّ منتهٍ في تاريخ المكتب دفعةً واحدة.
//   ⇒ فتُختَم **كلُّ** المشتركين المنتهين الآن: «أُبلِغوا سلفاً». فلا يُرسَل إلّا لمن
//     ينتهي **بعد اليوم** — وهو عينُ المطلوب: «الجددُ في تلك الفئة».
//   (وحرسٌ ثانٍ في الشيفرة: نافذةٌ عُلويّةٌ ٧ أيّامٍ فوق N، فلا يُفاجَأ منتهٍ قديمٌ برسالة.)
//
// 🔑 والميزةُ **مُطفأةٌ افتراضاً** (`expiredNoticeEnabled` فارغ): ميزةٌ تُرسل رسائلَ لا
//   تُشتغل بنفسها على مكاتبَ لم يطلبها أصحابُها. فلا يتغيّر شيءٌ حتى يُفعّلها محمد.
//
// 🔒 والأذونُ تُقاس: العاملُ (حاسبةُ المكتب) هو مَن يُشغّل المُجدول ⇒ يحتاج **قراءةَ**
//   أعمدة المكتب الجديدة و**كتابةَ** ختمِ المشترك وحَجزِ اليوم. وعمودٌ بلا GRANT
//   **غيرُ مرئيٍّ للدور** — وهي العلّةُ التي أذهبت القيادةَ ساعةً وربعاً قبل أيّام.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { Client } = req("pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("⛔ لا DATABASE_URL"); process.exit(1); }
const c = new Client({ connectionString: url, ...(url.includes("sslmode=no-verify") ? {} : { ssl: { rejectUnauthorized: false } }) });
await c.connect();
try {
  console.log("═══ البند ٤-أ · «المنتهون منذ N يوم» ═══\n");

  const addCol = async (table, col, type) => {
    const has = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, col]);
    if (has.rowCount) { console.log(`• ${table}.${col} موجودٌ سابقاً`); return false; }
    await c.query(`ALTER TABLE ${table} ADD COLUMN "${col}" ${type}`);
    console.log(`✅ أُضيف ${table}.${col} ${type}`);
    return true;
  };

  // ١) أعمدةُ إعداد المكتب + حَجزُ اليوم
  await addCol("towers", "expiredNoticeEnabled", "TEXT");
  await addCol("towers", "expiredNoticeDays", "INTEGER");
  await addCol("towers", "expiredNoticeTime", "TEXT");
  await addCol("towers", "lastExpiredNoticeDate", "TEXT");
  // ٢) ختمُ المشترك
  const fresh = await addCol("subscribers", "expiredNoticeAt", "TIMESTAMP(3)");

  // ٣) 🔴 الردمُ — يُنفَّذ **مرّةً واحدةً** عند إنشاء العمود حصراً
  if (fresh) {
    const before = await c.query(
      `SELECT count(*)::int AS n FROM subscribers
        WHERE "isDeleted"=false AND "dateTo" IS NOT NULL AND "dateTo" < (NOW() AT TIME ZONE 'UTC')`);
    const r = await c.query(
      `UPDATE subscribers SET "expiredNoticeAt" = (NOW() AT TIME ZONE 'UTC')
        WHERE "isDeleted"=false AND "dateTo" IS NOT NULL AND "dateTo" < (NOW() AT TIME ZONE 'UTC')
          AND "expiredNoticeAt" IS NULL`);
    console.log(`\n🛡️ الردم: ${r.rowCount} مشتركاً منتهياً خُتِم «أُبلِغ سلفاً» (المنتهون الآن: ${before.rows[0].n})`);
    console.log("   ⇒ فلا يُرسَل إلّا لمن ينتهي بعد اليوم — ولا رشقةَ لتاريخ المكتب كلِّه.");
  } else {
    console.log("\n• العمودُ ليس جديداً ⇒ **لا ردمَ** (لو رُدم ثانيةً لأُسكِت منتهون ينتظرون رسالتَهم بحقّ)");
  }

  // ٤) الأذون: يُمنَح لكلّ دورٍ يقرأ/يكتب الجدولَ سلفاً — قياساً لا افتراضاً
  const grantLike = async (table, cols) => {
    const rows = (await c.query(
      `SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
        WHERE table_name=$1 AND grantee LIKE 'agent%'`, [table])).rows;
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
      for (const col of cols) {
        if (have.has(col)) continue;
        await c.query(`GRANT ${priv} ("${col}") ON ${table} TO "${role}"`);
        n++;
      }
    }
    console.log(`• ${table}: مُنِح ${n} إذنَ عمودٍ لأدوار الوكلاء`);
  };
  await grantLike("towers", ["expiredNoticeEnabled", "expiredNoticeDays", "expiredNoticeTime", "lastExpiredNoticeDate"]);
  await grantLike("subscribers", ["expiredNoticeAt"]);

  // ٥) تحقّقٌ نهائيّ: لا دورَ يقرأ الجدولَ والعمودُ أعمى في وجهه
  for (const [table, col] of [["towers", "lastExpiredNoticeDate"], ["subscribers", "expiredNoticeAt"]]) {
    const blind = await c.query(
      `SELECT DISTINCT g.grantee FROM information_schema.column_privileges g
        WHERE g.table_name=$1 AND g.grantee LIKE 'agent%' AND g.privilege_type='SELECT'
          AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges x
            WHERE x.table_name=$1 AND x.grantee=g.grantee AND x.privilege_type='SELECT' AND x.column_name=$2)`,
      [table, col]);
    if (blind.rowCount) {
      console.log(`🔴 ${table}.${col} أعمى في وجه: ${blind.rows.map((b) => b.grantee).join(", ")}`);
      process.exitCode = 1;
    } else console.log(`🔒 ${table}.${col} مرئيٌّ لكلّ دورٍ يقرأ الجدول`);
  }

  // ٦) صورةُ الحال
  const st = await c.query(
    `SELECT count(*) FILTER (WHERE "expiredNoticeEnabled"='1')::int AS on_offices, count(*)::int AS offices FROM towers WHERE "isDeleted"=false`);
  const su = await c.query(
    `SELECT count(*)::int AS all_subs, count("expiredNoticeAt")::int AS stamped FROM subscribers WHERE "isDeleted"=false`);
  console.log(`\n• المكاتبُ المُفعِّلةُ للميزة: ${st.rows[0].on_offices} من ${st.rows[0].offices} (صفرٌ متوقَّع — تُفعَّل بيد محمد)`);
  console.log(`• المشتركون: ${su.rows[0].all_subs} · مختومون: ${su.rows[0].stamped}`);
} catch (e) {
  console.error("🔴", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
