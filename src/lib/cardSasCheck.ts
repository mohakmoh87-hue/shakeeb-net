import { prisma } from "@/lib/prisma";
import { sasBaseUrl, sasLogin, sasSearchActivation } from "@/lib/sas4";

// ═════ 🔍 «أين هذا الكارت؟» — الفحصُ **قبل** رفعِ الحالة (طلبُ محمد 2026-08-14) ═════
//
// نصُّه: «كلُّ كارتٍ يُستهلك هو لشهرٍ واحدٍ فقط، فإذا كارتان يعني شهرَين. لكنّ السؤالَ
//  الأهمّ: **أين هذه الكروتُ الآن؟ هل كلُّها استُخدمت؟** وما مصيرُ غيرِ المستخدَم إن كان
//  غيرَ مستخدَم؟ **والأحرى بحارس المال أن يفحص أين هو هذا الكارتُ** ليُخبرني بكارتٍ
//  استُهلك بمبلغِ صفر.» ثمّ: «كان يجب عليه أن **يفحص أوّلاً** وبعدها يُعطي الحالة.»
//
// 🔴 **وأوّلُ قياسٍ على الإنتاج كشف أخطرَ من السؤال**: من ثمانيةِ كروتٍ في خمسِ عمليّات،
//   **ثلاثةٌ مربوطةٌ في البرنامج بمشتركٍ غيرِ الذي استهلكها في الساس**:
//     • `490548619878085` — البرنامج: ليث ستار (٤٦٬٠٠٠) · الساس: **مروان كريم عكيش**
//     • `377061353405719` — البرنامج: مشترك ٢٧٩٥٩ · الساس: **قحطان كاظم عبيد**
//     • `371078030969621` — البرنامج: وسام (مكتب ٧) · الساس: **أحمد جاسم** في realm **@res**
//   أي أنّ المالَ نُسب لمشتركٍ والخدمةَ نالها آخر. ولا يُكشَف ذلك بأيّ استعلامٍ على
//   قاعدتنا وحدَها — **الساسُ هو الحقيقة**، وهذا ما يجعل هذا الفحصَ لا بديلَ عنه.
//
// ⛔ **ثمّ ألغى محمد المسحَ الدوريَّ (2026-08-14) لأنّه يزيد الفاتورة**، وقولُه: «يكفي أنّ
//   الحارسَ يشتغل عند حذفِ كارتٍ فيأخذ ذلك الكارتَ وحدَه ويفحصه، لأنّ **المزامنةَ اليوميّةَ
//   تفحص جميعَ الكروت يوميّاً أصلاً**». وهو محقّ: كان المسحُ ~٤٣٠٠ نداءَ ساسٍ يوميّاً
//   لمعلومةٍ تُنتجها المزامنةُ مجّاناً. فبقيت هذه الدالّةُ **للتدقيق عند الطلب لا دوريّاً**
//   (تُنادى من سكربتٍ يدويٍّ إن أراد جردَ مخزنٍ كامل)، والفحصُ الحيُّ في `cardDeleteGuard`.
//
// ⚙️ وبحثُ الساس ~١.٥ث للكارت، فلا يُنادى من مسارٍ يستجيب لمستخدم: يُخزَّن الحكمُ في
//   `card_sas_checks` ويُحدَّث بمسحٍ دوريٍّ صامت، ولوحةُ الحارس تقرأ **الحكمَ الثابت**.
//   فتصير الحالةُ «كارتٌ استُهلك ومالُه صفرٌ **وهو في الساس لفلان**» لا سؤالاً معلَّقاً.

export type CardVerdict = "match" | "mismatch" | "not-found" | "error";

/** يُقرِّر الحكمَ: هل صاحبُ الكارت في الساس هو صاحبُه في البرنامج؟ */
function judge(sasUsername: string | null, netUser: string | null): CardVerdict {
  if (!sasUsername) return "not-found";
  if (!netUser) return "mismatch"; // كارتٌ بلا مشتركٍ في البرنامج والساسُ يعرف صاحبَه
  // المقارنةُ حرفيّةٌ بعد التطبيع: الـrealm جزءٌ من الهويّة (`@mu` ≠ `@res`) فلا يُقصّ
  return sasUsername.trim().toLowerCase() === netUser.trim().toLowerCase() ? "match" : "mismatch";
}

/**
 * مسحٌ صامت: يفحص كروتاً مستخدَمةً لم تُفحَص بعد (أو مضى على فحصها أسبوع)، ويخزّن الحكم.
 * 🔒 معزولٌ بالوكيل في **كلّ** استعلام، وجلساتُ الساس من لوحات وكيله وحدَه.
 */
export async function sweepCardSasChecks(agentId: number, limit = 20): Promise<{ checked: number; mismatch: number }> {
  const out = { checked: 0, mismatch: 0 };
  const weekAgo = new Date(Date.now() - 7 * 86400_000);

  // الأولويّةُ لِما يُحتاج في الحالات: كروتٌ مستخدَمةٌ حديثاً ولم يُفحَص سيريالُها
  const done = await prisma.cardSasCheck.findMany({
    where: { agentId, checkedAt: { gte: weekAgo } }, select: { serial: true },
  });
  const skip = new Set(done.map((d) => d.serial));
  const cards = (await prisma.rechargeCard.findMany({
    where: { agentId, useDate: { not: null }, serial: { not: null } },
    orderBy: { useDate: "desc" }, take: limit * 6,
    select: { id: true, serial: true, subscriberId: true },
  })).filter((c) => c.serial && !skip.has(c.serial)).slice(0, Math.max(1, Math.min(100, limit)));
  if (!cards.length) return out;

  // يوزرُ المشترك كما يقوله البرنامج
  const subIds = [...new Set(cards.map((c) => c.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, netUser: true } })
    : [];
  const userOf = new Map(subs.map((s) => [s.id, s.netUser]));

  // جلساتُ لوحاتِ هذا الوكيل — والبحثُ الموجَّه يجد التفعيلَ في أيّها كان
  const sessions: { base: string; token: string }[] = [];
  for (const t of await prisma.tower.findMany({
    where: { agentId, isDeleted: false },
    select: { loginUrl: true, username: true, password: true },
  })) {
    if (!t.loginUrl || !t.username || !t.password) continue;
    try {
      const base = sasBaseUrl(t.loginUrl);
      sessions.push({ base, token: await sasLogin(base, t.username, t.password) });
    } catch { /* لوحةٌ متعذّرةٌ تُتخطّى، والحكمُ يبقى بما وُجد */ }
  }
  if (!sessions.length) return out;

  for (const card of cards) {
    const serial = (card.serial ?? "").trim();
    if (!serial) continue;
    out.checked++;
    let hit: Awaited<ReturnType<typeof sasSearchActivation>> = null;
    let verdict: CardVerdict = "not-found";
    try {
      for (const s of sessions) {
        hit = await sasSearchActivation(s.base, s.token, serial);
        if (hit) break;
      }
      verdict = judge(hit?.username ?? null, card.subscriberId != null ? (userOf.get(card.subscriberId) ?? null) : null);
    } catch { verdict = "error"; }
    if (verdict === "mismatch") out.mismatch++;
    const data = {
      agentId, serial, cardId: card.id, subscriberId: card.subscriberId,
      sasUsername: hit?.username ?? null, sasName: hit?.name ?? null,
      sasMethod: hit?.method ?? null, sasCreatedAt: hit?.createdAt ?? null,
      sasOldExpiry: hit?.oldExpiration ?? null, sasNewExpiry: hit?.newExpiration ?? null,
      sasPrice: typeof hit?.price === "number" ? hit.price : null,
      verdict, checkedAt: new Date(),
    };
    await prisma.cardSasCheck.upsert({
      where: { agentId_serial: { agentId, serial } }, create: data, update: data,
    }).catch(() => {});
  }
  return out;
}
