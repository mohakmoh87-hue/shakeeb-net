import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ===== حارس اتصالات القاعدة (بلاغ محمد 2026-08-10: «الموقع لا يعمل») =====
// قاعدة Aiven حدُّها ٢٠ اتصالاً، منها ٣ محجوزةٌ للنظام ⇒ **١٧ متاحاً**. وتجمّع كلّ عمليّة ٢
// (prisma.ts). فمع سبع حاسبات مكاتب (١٤) + الموقع (٢) + اتصالات Aiven الداخليّة تجاوزنا السقف،
// فسقطت كلّ صفحةٍ تحتاج القاعدة بـP2037 (TooManyConnections) ثمّ انهارت الحاوية وأُعيد تشغيلها.
//
// هذا الحارس **سحابيٌّ بحتٌ**: لا يلمس حاسبات المكاتب ولا يُعيد تشغيلها ولا يحتاج تغيير إعدادٍ
// عندها (الملفّ داخل src/app ⇒ مُستثنى من إعادة تشغيل العامل). ويعمل بثلاث قواعد آمنة:
//   ١) اتصالٌ **معلَّقٌ داخل معاملة** أكثر من دقيقة ⇒ يُنهى (تسريبٌ حقيقيّ: رُصد ٤٨٧ ثانية).
//   ٢) اتصال عاملٍ **خامل** أكثر من ٢٠ ثانية ⇒ يُنهى (تجمّعه يفتح غيره فوراً عند الحاجة).
//   ٣) **حصّةٌ عادلة**: عاملٌ يحمل أكثر من MAX_PER_WORKER ⇒ تُنهى الزائدة **الخاملة** فقط.
// ⛔ لا يُنهى اتصالٌ **نشط** أبداً (استعلامٌ جارٍ) — فلا يُقطع عملُ أحد.
// ⚠️ **مشروطٌ بالضغط** (قيد محمد: النقل إلى Railway الليلة): لا يتدخّل الحارس إلّا إذا كانت
// الاتصالات على وشك النفاد. فقاعدة Railway حدُّها أوسع بكثير ⇒ يبقى الحارس **نائماً تماماً** بعد
// النقل بلا أيّ إعدادٍ أو تعديل، ولا يعبث بتجمّعات صحيحة. والاستثناء الوحيد الذي يُنفَّذ دائماً:
// اتصالٌ معلَّقٌ داخل معاملة دقائقَ (تسريبٌ يجب أن يُنهى في أيّ قاعدةٍ وأيّ حدّ).
const PRESSURE_FREE_SLOTS = 5; // أقلّ من هذا العدد من الفتحات الحرّة = ضغط
const MAX_PER_WORKER = 1;
const IDLE_SEC = 20;
const IDLE_TX_SEC = 60;
const LEAK_TX_SEC = 300; // معاملةٌ عالقة ٥ دقائق: تُنهى دائماً، بضغطٍ أو بلا ضغط

type Row = { pid: number; usename: string | null; state: string | null; idle_sec: number | null };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }

  const before = await prisma.$queryRaw<{ used: bigint; max_conn: string; reserved: string }[]>`
    SELECT count(*) AS used,
           (SELECT setting FROM pg_settings WHERE name = 'max_connections') AS max_conn,
           (SELECT setting FROM pg_settings WHERE name = 'superuser_reserved_connections') AS reserved
      FROM pg_stat_activity`;
  const maxConn = Number(before[0]?.max_conn ?? 0);
  const reserved = Number(before[0]?.reserved ?? 0);
  const used = Number(before[0]?.used ?? 0);
  const freeSlots = Math.max(0, maxConn - reserved - used);
  const underPressure = freeSlots < PRESSURE_FREE_SLOTS;

  const targets = new Map<number, Row>();

  // يُنفَّذ **دائماً**: معاملةٌ عالقة دقائقَ = تسريب، تُنهى في أيّ قاعدةٍ وأيّ حدّ
  const leaks = await prisma.$queryRaw<Row[]>`
    SELECT pid, usename, state, extract(epoch FROM (now() - state_change))::int AS idle_sec
      FROM pg_stat_activity
     WHERE pid <> pg_backend_pid() AND state = 'idle in transaction'
       AND state_change < now() - (${LEAK_TX_SEC} || ' seconds')::interval`;
  for (const r of leaks) targets.set(Number(r.pid), r);

  if (underPressure) {
    // (١) و(٢): معاملةٌ عالقة أقصر، أو خاملٌ طويل لدور عامل
    const stale = await prisma.$queryRaw<Row[]>`
      SELECT pid, usename, state, extract(epoch FROM (now() - state_change))::int AS idle_sec
        FROM pg_stat_activity
       WHERE pid <> pg_backend_pid()
         AND (
           (state = 'idle in transaction' AND state_change < now() - (${IDLE_TX_SEC} || ' seconds')::interval)
           OR (state = 'idle' AND usename LIKE 'agent\\_%\\_worker'
               AND state_change < now() - (${IDLE_SEC} || ' seconds')::interval)
         )`;
    // (٣) الحصّة العادلة: لكلّ دور عاملٍ اتصالاتُه الخاملة الزائدة عن الحدّ (الأحدث أوّلاً)
    const extra = await prisma.$queryRaw<Row[]>`
      WITH ranked AS (
        SELECT pid, usename, state,
               extract(epoch FROM (now() - state_change))::int AS idle_sec,
               row_number() OVER (PARTITION BY usename ORDER BY backend_start DESC) AS rn
          FROM pg_stat_activity
         WHERE usename LIKE 'agent\\_%\\_worker' AND state = 'idle' AND pid <> pg_backend_pid()
      )
      SELECT pid, usename, state, idle_sec FROM ranked WHERE rn > ${MAX_PER_WORKER}`;
    for (const r of [...stale, ...extra]) targets.set(Number(r.pid), r);
  }

  let killed = 0;
  for (const [pid, r] of targets) {
    try {
      // شرطٌ مكرَّرٌ داخل الإنهاء: لا نُنهي اتصالاً صار **نشطاً** بين القراءة والتنفيذ
      const res = await prisma.$queryRaw<{ done: boolean }[]>`
        SELECT pg_terminate_backend(pid) AS done FROM pg_stat_activity
         WHERE pid = ${pid} AND state <> 'active'`;
      if (res.length && res[0].done) killed++;
      void r;
    } catch { /* اتصالٌ انتهى من نفسه — تجاهل */ }
  }

  const after = await prisma.$queryRaw<{ used: bigint; idle: bigint }[]>`
    SELECT count(*) AS used, count(*) FILTER (WHERE state = 'idle') AS idle FROM pg_stat_activity`;

  const out = {
    ok: true,
    max: maxConn,
    reserved,
    before: used,
    after: Number(after[0]?.used ?? 0),
    idle: Number(after[0]?.idle ?? 0),
    freeSlots,
    underPressure, // false ⇒ الحارس نائم (لم يتدخّل إلّا في تسريبٍ إن وُجد)
    killed,
    details: [...targets.values()].map((r) => ({ role: r.usename, state: r.state, idleSec: r.idle_sec })),
  };
  if (killed > 0) console.log(`[cron/db-guard] حُرِّر ${killed} اتصالاً — المستهلك ${out.before} ← ${out.after}/${out.max}${underPressure ? " (ضغط)" : " (تسريب)"}`);
  return NextResponse.json(out);
}
