// هجرة: عمود rewardGrantCount على subscribers (إضافي، افتراضي 0، آمن) + تهيئته
// من سجل المكافآت للمشتركين ذوي الرصيد — كي يسري حد الـ10 منح على التراكم الحالي فوراً.
// التهيئة تكتب العمود الجديد فقط ولا تمسّ أي بيانات قائمة.
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL مفقود"); process.exit(1); }
const sql = neon(url);

await sql`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS "rewardGrantCount" integer NOT NULL DEFAULT 0`;
console.log("column added (or already exists)");

// المشتركون ذوو رصيد مكافأة — هم وحدهم من قد يملك عدّاداً > 0
// (من سحب كل رصيده أو مُسح كوده فعدّاده صفر أصلاً)
const subs = await sql`SELECT id FROM subscribers WHERE COALESCE("rewardBalance", 0) > 0 AND "isDeleted" = false`;
console.log(`subscribers with balance: ${subs.length}`);

let updated = 0;
for (const s of subs) {
  const logs = await sql`SELECT kind, amount, "balanceAfter" FROM reward_logs WHERE "subscriberId" = ${s.id} ORDER BY id ASC`;
  // إعادة تمثيل العدّاد: منحة تبدأ رصيداً من صفر (balanceAfter == amount) = بداية تراكم جديد؛
  // السحب/المسح يصفّر؛ عكس المنح يُنقص واحداً
  let count = 0;
  for (const l of logs) {
    if (l.kind === "grant") count = Number(l.balanceAfter) === Number(l.amount) ? 1 : count + 1;
    else if (l.kind === "redeem" || l.kind === "clear") count = 0;
    else if (l.kind === "reverse") count = Math.max(0, count - 1);
  }
  if (count > 0) {
    await sql`UPDATE subscribers SET "rewardGrantCount" = ${count} WHERE id = ${s.id}`;
    updated++;
  }
}
console.log(`initialized counters: ${updated}`);

const top = await sql`SELECT id, name, "rewardBalance", "rewardGrantCount" FROM subscribers WHERE "rewardGrantCount" > 0 ORDER BY "rewardGrantCount" DESC LIMIT 5`;
console.log("top counters:", top);
