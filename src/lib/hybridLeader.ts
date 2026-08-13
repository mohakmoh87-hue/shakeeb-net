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
  const now = new Date();
  const until = new Date(now.getTime() + LEASE_MS);
  try {
    // (١) تجديدُ إجارتي — الطريقُ الشائعُ وأرخصُه
    const renewed = await prisma.agent.updateMany({
      where: { id: agentId, leaderMachineId: machineId },
      data: { leaderUntil: until },
    });
    if (renewed.count === 1) return true;
    // (٢) انتزاعُها: حرّةٌ أو منتهيةٌ فقط. `updateMany` ذرّيّةٌ ⇒ فائزٌ واحدٌ لا أكثر.
    const taken = await prisma.agent.updateMany({
      where: { id: agentId, OR: [{ leaderMachineId: null }, { leaderUntil: null }, { leaderUntil: { lt: now } }] },
      data: { leaderMachineId: machineId, leaderUntil: until },
    });
    return taken.count === 1;
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
  await prisma.agent.updateMany({
    where: { id: agentId, leaderMachineId: machineId },
    data: { leaderMachineId: null, leaderUntil: null },
  }).catch(() => {});
}
