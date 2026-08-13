import { prisma } from "@/lib/prisma";

// حاسبة تُعدّ "متصلة" إن أرسلت نبضة خلال آخر 60 ثانية
export const ONLINE_WINDOW_MS = 60 * 1000;

// قائد وكيل محدّد = حاسبته المتصلة المُعتمَدة صاحبة أصغر أولوية (ثم أصغر id).
// كل وكيل له قائده الخاص، يستضيف واتساب مكاتب هذا الوكيل فقط (عزل بين الوكلاء).
export async function computeLeaderMachineId(agentId: number | null | undefined): Promise<string | null> {
  if (agentId == null) return null;
  const since = new Date(Date.now() - ONLINE_WINDOW_MS);
  const online = await prisma.hybridWorker.findMany({
    where: { approved: true, agentId, lastSeen: { gte: since } },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: 1,
    select: { machineId: true },
  });
  return online[0]?.machineId ?? null;
}

export function isOnline(lastSeen: Date): boolean {
  return Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_MS;
}

// ═════ ب-١/الأصل ١ · القيادةُ صارت **إجارةً** لا استنتاجاً (2026-08-13) ═════
// 🔴 كانت القيادةُ **مُشتقّةً** من `lastSeen`: كلُّ حاسبةٍ تحسبها لنفسها كلَّ ٢٠ ثانية.
//   وهي متّفقةٌ في الاستقرار، لكنّ لحظةَ الانتقال (تعطُّلُ القائد ثمّ عودتُه) تسمح بأن
//   تَرى حاسبتان نفسَيهما قائدتَين — فيُستضاف الواتساب مرّتَين على الجلسة نفسِها
//   («The browser is already running…» ⇒ ضياعُ الجلسة)، وتُنفَّذ مهامُّ القائد مرّتَين.
//   **والقيادةُ وحدَها لا تكفي حَجزاً**: لا شيءَ في القاعدة يمنع اثنَين من ادّعائها.
//
// 🔑 والتصميمُ يحفظ **أولويّةَ محمد**: الأولويّةُ تُحدّد **مَن يستحقّ** القيادة
//   (`computeLeaderMachineId` كما هي)، والإجارةُ تُحدّد **مَن يملكها فعلاً** — صفٌّ
//   واحدٌ بمالكٍ ومهلةٍ، يُنتزَع بمقارنةٍ-وتبديلٍ ذرّيّة. فالمستحقُّ يأخذها، ومَن
//   لم يعد مستحقّاً **يُطلقها فوراً** فلا تتراكب إجارتان أبداً.
//
// والمهلةُ ٦٠ ثانيةً = نافذةُ «متصلة» نفسُها: نبضةٌ كلَّ ٢٠ث ⇒ ثلاثُ فرصٍ للتجديد،
// وإن مات القائدُ خرج من النافذة وانتهت إجارتُه في اللحظة نفسِها فلا فراغَ ولا تراكب.
export const LEASE_MS = ONLINE_WINDOW_MS;

/** يُجدّد إجارةَ القيادة أو ينتزعها إن كانت حرّةً/منتهية. `false` = يملكها غيري الآن.
 *
 *  ═════ 🔴 درسٌ دُفع ثمنُه حيّاً (2026-08-13) ═════
 *  أُضيفت الإجارةُ فمات القيادةُ على **كلّ** الحاسبات ساعةً وربعاً: دورُ العامل يملك
 *  `SELECT` على **أعمدةٍ بعينها** لا على جدول `agents`، والعمودان الجديدان خارجَها —
 *  وكلُّ استعلامٍ هنا يذكرهما في `WHERE`. فرمى الاستعلامُ «permission denied»، والرميُ
 *  يُلتقَط في `beat()` **قبل** إسنادِ `leaderNow` فبقيت `false` أبداً ⇒ لا واتساب يُستضاف،
 *  ولا مزامنةَ أودو، ولا مهامَّ قائد. (والـGRANT الذي كتبتُه غطّى `UPDATE` وحدَه، وفحصي
 *  نجح لأنّ شرطَه كان `id` وحدَه فلم يمسّ العمودَين.)
 *
 *  ⇒ القاعدةُ: **حارسٌ جديدٌ لا يجوز أن يُعطّل ما يحرسه**. فأيُّ خطأٍ غيرِ متوقَّعٍ هنا
 *    (صلاحيّة · عمودٌ ناقص · انقطاع) يعني «لا أعرف»، و«لا أعرف» يجب أن تسقط إلى
 *    **السلوك القديم** (المستحقُّ يقود) لا إلى تعطيلِ النظام. فالتنفيذُ المزدوجُ في
 *    لحظةِ انتقالٍ نادرةٍ أهونُ ألفَ مرّةٍ من توقُّفِ كلّ عملٍ خلفيٍّ في كلّ مكتب.
 */
export async function acquireLeadership(agentId: number, machineId: string): Promise<boolean> {
  try {
    // ═════ 🔴 ولماذا SQL صريحٌ لا `prisma.agent.updateMany`؟ (قِيس، لا يُخمَّن) ═════
    // جدولُ `agents` فيه **٢٦ عموداً** ودورُ العامل يقرأ **١٥** منها (الحصصُ وتاريخُ
    // الخطّة ورابطُ قاعدته خارجَها بقصد). وبريزما في نسخة المشروع (محرّكُ العميل)
    // تقرأ **الصفَّ كاملاً** عند `updateMany` ⇒ `SELECT *` ⇒ «permission denied for
    // table agents» — وهي رسالةٌ على مستوى **الجدول** فتبدو كأنّها غيابُ صلاحيّةٍ كليّ.
    // وأُثبت الفرقُ بالتجربة: `SELECT *` يُرفض و`SELECT id` ينجح بالدور نفسِه.
    // ⇒ فالحلُّ ليس توسيعَ الصلاحيّة (فتنكشف الحصصُ والخطّةُ لكلّ عاملٍ بلا داعٍ)
    //   بل نصُّ SQL يمسّ الأعمدةَ الممنوحةَ وحدَها. و`$executeRaw` يُرجع عددَ الصفوف
    //   المتأثّرة — وهو تماماً ما تحتاجه المقارنةُ-والتبديل.
    //
    // 🔑 وفائدةٌ ثانيةٌ مقصودة: المهلةُ تُحسَب بـ**ساعةِ القاعدة** لا بساعةِ الحاسبة
    //   (`NOW() AT TIME ZONE 'UTC'` في الكتابة والمقارنة معاً). فإجارةٌ موزّعةٌ تُحكَم
    //   بساعاتٍ متعدّدةٍ تنكسر بأوّلِ انحرافِ ساعةٍ في مكتب — وحاسباتُ المكاتب لا
    //   يضبط أحدٌ ساعاتِها. والعمودُ `timestamp without time zone` يحمل UTC (كما تكتبه
    //   بريزما) فالتحويلُ الصريحُ يُطابقه.
    const secs = Math.round(LEASE_MS / 1000);
    // (١) تجديدُ إجارتي — الطريقُ الشائعُ وأرخصُه
    const renewed = await prisma.$executeRaw`
      UPDATE agents
         SET "leaderUntil" = (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${secs})
       WHERE id = ${agentId} AND "leaderMachineId" = ${machineId}`;
    if (renewed === 1) return true;
    // (٢) انتزاعُها: حرّةٌ أو منتهيةٌ فقط. الجملةُ ذرّيّةٌ ⇒ فائزٌ واحدٌ لا أكثر.
    const taken = await prisma.$executeRaw`
      UPDATE agents
         SET "leaderMachineId" = ${machineId},
             "leaderUntil" = (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${secs})
       WHERE id = ${agentId}
         AND ("leaderMachineId" IS NULL
              OR "leaderUntil" IS NULL
              OR "leaderUntil" < (NOW() AT TIME ZONE 'UTC'))`;
    return taken === 1;
  } catch (e) {
    // ليس «يملكها غيري» بل «تعذّر الحجزُ» — فالسقوطُ إلى السلوك القديم لا إلى التعطيل.
    // ويُصرَّح بالسبب في السجلّ لأنّ صمتَ هذا الموضع هو ما أخفى العلّةَ ساعةً وربعاً.
    console.error("[hybrid-leader] ⚠️ تعذّر حجزُ إجارة القيادة — يُعمَل بالاستحقاق وحدَه:",
      e instanceof Error ? e.message : e);
    return true;
  }
}

/** يُطلق الإجارةَ إن كنتُ مالكَها — عند فقدان الاستحقاق أو الإغلاق النظيف.
 *  فبلا إطلاقٍ ينتظر القائدُ الجديدُ انتهاءَ المهلة بلا داعٍ (والقديمُ حيٌّ لا يقود). */
export async function releaseLeadership(agentId: number, machineId: string): Promise<void> {
  // SQL صريحٌ لنفس السبب أعلاه: `updateMany` تقرأ الصفَّ كاملاً فتُرفَض بدور العامل
  await prisma.$executeRaw`
    UPDATE agents SET "leaderMachineId" = NULL, "leaderUntil" = NULL
     WHERE id = ${agentId} AND "leaderMachineId" = ${machineId}`
    .then(() => {}, () => {});
}
