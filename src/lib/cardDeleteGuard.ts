// ═════════════ 🛡️ حارسُ المال · لا يُحذَف كارتٌ بلا فحص (طلبُ محمد 2026-08-14) ═════════════
//
// نصُّ الطلب: «حارسُ المال يقوم **بشكلٍ صامتٍ كليّاً** بأخذ أيّ كارتٍ محذوفٍ وفحصِه في الساس:
// هل فُعِّل لمشتركٍ تابعٍ لي؟ وإذا فُعِّل، هل سُجِّل له وصلُ قبض؟ فإن كان الأمرُ طبيعيّاً
// يحذفه نهائيّاً، وإن كان به شيءٌ غيرُ طبيعيٍّ **يُبلِّغ بالحالة**.
// **فلا يكون هنالك مرورٌ لكارتٍ محذوفٍ بلا فحص الحارس له.**»
//
// 🔴 **والحاجةُ أثبتَها حادثٌ مقيسٌ اليوم**: ٧٤ كارتاً من وجبة ٩ آب حُذفت بحكم «الكروت
//   الوهميّة». وفُحصت بالبحث الموجَّه فكانت **٧٤ من ٧٤ مُفعَّلةً في الساس بطريقة `voucher`،
//   ولكلٍّ تفعيلٌ في البرنامج بمبلغٍ مقبوضٍ ٣٥٬٠٠٠ ومدّةِ ٣١ يوماً**. أي كروتٌ حقيقيّةٌ
//   بيعت وقُبض ثمنُها — حُذفت ظلماً.
//   ⚠️ **ولماذا تعذّر كشفُها إلّا بقائمةٍ من محمد؟** لأنّ سجلَّ الحذف كان يكتب **مُعرِّفات**
//   الكروت لا **سيريالاتها**، والصفوفُ تُحذف ⇒ المُعرِّفُ يصير رقماً لا يدلّ على شيء.
//   فاللقطةُ قبل الحذف هي **كلُّ** الفرق بين حادثةٍ تُكتشَف وحادثةٍ تُدفَن.
//
// 🔑 وأداةُ الفحص **دالّةُ «ربط كارت»** كما طلب محمد: `sasSearchActivation` — بحثٌ موجَّهٌ
//   بالسيريال يجد التفعيل مهما كان تاريخُه ومَن أجراه. وهي التي وجدت ٧٤ من ٧٤ بينما
//   القائمةُ الجماعيّةُ لم تُظهر واحداً.
import { prisma } from "@/lib/prisma";
import { sasBaseUrl, sasLogin, sasSearchActivation } from "@/lib/sas4";
import { notify } from "@/lib/notify";

/** حذفٌ بهذا الحجم أو أقلّ يُفحَص **فوراً قبل الردّ** (طلبُ محمد: «يتصرّف الحارسُ فور
 *  حدوث الحذف»). وما فوقه يُفحَص بالخلفيّة ثمّ بالمسح الدوريّ — فبحثُ الساس ~١.٥ث للكارت،
 *  وحذفُ مئةٍ inline يعني انتظارَ المستخدم دقائق. */
export const GUARD_INLINE_MAX = 5;

/** أحكامُ الحارس. «طبيعيّ» وحدَه يمرّ صامتاً؛ وما عداه يُبلَّغ. */
export type CardVerdict =
  | "pending"
  | "normal"          // لا شيءَ للعمل — يمرّ صامتاً
  | "sold-unrecorded" // 🔴 غيرُ مستخدَمٍ في البرنامج **ومُفعَّلٌ في الساس** — أخطرُها
  | "no-receipt"      // 🔴 مُفعَّلٌ لمشتركك بلا وصلِ قبض
  | "used-not-in-sas" // ⚠️ البرنامجُ يقول مستخدَمٌ والساسُ لا يعرفه
  | "bad-duration"    // ⚠️ مالٌ مقبوضٌ ومدّةٌ مقلوبة
  | "error";

/**
 * 🛡️ **اللقطةُ قبل الحذف — لا تُتخطّى أبداً.**
 * تُنادى **قبل** أيّ `delete`/`deleteMany` على الكروت، فتحفظ الصفَّ كاملاً بسيريالِه.
 * سريعةٌ (استعلامان) فتصلح لمسارٍ متزامنٍ يستجيب لمستخدم، والفحصُ في الساس يأتي لاحقاً
 * صامتاً — فبناءُ الفحص هنا يعني انتظارَ المستخدم دقائقَ لحذفِ مئةِ كارت.
 *
 * @returns عددُ الصفوف المُلتقَطة (يساوي عددَ ما سيُحذَف).
 */
export async function captureCardsBeforeDelete(
  cardIds: number[],
  agentId: number | null,
  deletedBy: string | null,
  reason: "phantom" | "bulk" | "single",
): Promise<number> {
  if (!cardIds.length) return 0;
  try {
    // 🔒 العزل: لا يُلتقَط (ولا يُحذَف) إلّا كارتُ هذا الوكيل — نفسُ شرط الحذف
    const rows = await prisma.rechargeCard.findMany({
      where: { id: { in: cardIds }, ...(agentId != null ? { agentId } : {}) },
      select: {
        id: true, agentId: true, serial: true, price: true, packageId: true,
        useDate: true, subscriberId: true,
        // 🔑 وبهذه وحدَها تصير الاستعادةُ ممكنةً: كارتٌ بلا رقمٍ وكلمةٍ لا يُفعَّل
        number: true, password: true, addDate: true, userName: true,
      },
    });
    if (!rows.length) return 0;
    const towerOf = new Map<number, number | null>();
    const subIds = [...new Set(rows.map((r) => r.subscriberId).filter((x): x is number => x != null))];
    if (subIds.length) {
      for (const s of await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, towerId: true } })) {
        towerOf.set(s.id, s.towerId);
      }
    }
    await prisma.deletedCardLog.createMany({
      data: rows.map((r) => ({
        agentId: r.agentId, cardId: r.id, serial: r.serial, price: r.price,
        packageId: r.packageId, useDate: r.useDate, subscriberId: r.subscriberId,
        number: r.number, password: r.password, addDate: r.addDate, userName: r.userName,
        towerId: r.subscriberId != null ? (towerOf.get(r.subscriberId) ?? null) : null,
        deletedBy, reason, verdict: "pending",
      })),
    });
    return rows.length;
  } catch (e) {
    // ⚠️ ولا يُمنَع الحذفُ إن تعذّرت اللقطة: منعُه يُعطّل ميزةً قائمةً بيد المدير.
    //   لكنّ التعذُّرَ يُسجَّل صريحاً فلا يمرّ حذفٌ غيرُ ملتقَطٍ بلا أثر.
    console.error("[card-guard] ⚠️ تعذّرت لقطةُ ما قبل الحذف — يُسجَّل ويُكمَل:", e instanceof Error ? e.message : e);
    await prisma.auditLog.create({
      data: {
        action: "CARD_GUARD_CAPTURE_FAILED", entity: "rechargeCard",
        entityId: cardIds.join(","),
        details: `تعذّرت لقطةُ ${cardIds.length} كارتاً قبل الحذف — لا سبيلَ لفحصها لاحقاً`,
      },
    }).catch(() => {});
    return 0;
  }
}

/**
 * 🕵️ **الفحصُ الصامت** — يُنادى **فورَ الحذف** (وللدفعات الكبيرة: خلفيّةً ثمّ دورةَ المُجدول).
 * لكلّ صفٍّ `pending` يُبحَث سيريالُه في لوحات **وكيله**، ثمّ يُحكَم:
 *   • **`normal`** — إمّا مُفعَّلٌ ولمشتركه وصلُ قبض، وإمّا غيرُ مستخدَمٍ ولا تفعيلَ له
 *     (مخزونٌ حُذف — عملٌ مشروع). وهذان وحدَهما يمرّان صامتَين.
 *   • **`sold-unrecorded`** — 🔴 البرنامجُ يحسبه مخزوناً والساسُ يقول مُفعَّل: خدمةٌ بلا
 *     وصلٍ ولا دَين، وحذفُه يمحو آخرَ أثرٍ لها. أخطرُ الأحكام.
 *   • **`no-receipt`** — 🔴 مُفعَّلٌ لمشترك الوكيل بلا وصلِ قبض.
 *   • **`bad-duration`** — ⚠️ المالُ مقبوضٌ والمدّةُ مقلوبةٌ أو صفر.
 *   • **`used-not-in-sas`** — ⚠️ مستخدَمٌ في البرنامج ولا تفعيلَ في الساس. **ولا يُحكَم
 *     بالوهميّة**: درسُ 2026-08-13 أنّ القائمةَ الجماعيّةَ أخفت ٧٤ تفعيلاً حقيقيّاً،
 *     و**غيابُ الدليل ليس دليلَ غياب**.
 *   • **`error`** — تعذّر الفحص (ساسٌ ساقطٌ أو لقطةٌ ناقصة) ⇒ يُعاد بزرّ «أعِد الفحص».
 */
export async function inspectPendingDeletedCards(
  limit = 50,
  /** 🔒 عزلٌ **صريح** حين يُنادى من حاسبة مكتب: RLS يحمي، لكنّ الاعتمادَ عليه وحدَه
   *  يعني أنّ خطأً في الدور يصير تسريباً. والشرطُ في الاستعلام لا يُنسى. */
  agentId?: number | null,
): Promise<{ checked: number; critical: number }> {
  const out = { checked: 0, critical: 0 };
  const pending = await prisma.deletedCardLog.findMany({
    where: { verdict: "pending", ...(agentId != null ? { agentId } : {}) },
    orderBy: { id: "asc" },
    take: Math.max(1, Math.min(500, limit)),
  });
  if (!pending.length) return out;

  // جلساتُ الساس **لكلّ وكيلٍ** على حِدة — 🔒 ولا يُبحَث كارتُ وكيلٍ في لوحات غيره
  const sessions = new Map<number, { base: string; token: string }[]>();
  const sessionsFor = async (agentId: number): Promise<{ base: string; token: string }[]> => {
    if (sessions.has(agentId)) return sessions.get(agentId)!;
    const list: { base: string; token: string }[] = [];
    for (const t of await prisma.tower.findMany({
      where: { agentId, isDeleted: false },
      select: { loginUrl: true, username: true, password: true },
    })) {
      if (!t.loginUrl || !t.username || !t.password) continue;
      try {
        const base = sasBaseUrl(t.loginUrl);
        list.push({ base, token: await sasLogin(base, t.username, t.password) });
      } catch { /* لوحةٌ متعذّرةٌ — تُتخطّى، والحكمُ يبقى بما وُجد */ }
    }
    sessions.set(agentId, list);
    return list;
  };

  for (const row of pending) {
    out.checked++;
    const serial = (row.serial ?? "").trim();
    // القيمةُ الابتدائيّة `error`: فلو خرج مسارٌ بلا حكمٍ صريحٍ ظهر ذلك حالاً ولم يُدفَن
    let verdict: CardVerdict = "error";
    let info = "";
    try {
      // ⚠️ **ولا حكمَ بلا ساس** — ولو كان الكارتُ «غيرَ مستخدَمٍ» في البرنامج.
      //   فنصُّ الطلب: «إن حُذف الكارتُ فهنا يجب أن يأخذه حارسُ المال **ويبحث هل هو
      //   مفعَّلٌ أم لا** ويُعطي إجابةً عليه». وهذا هو الفرقُ بين حارسٍ وضجيج:
      //   • غيرُ مستخدَمٍ **ولا في الساس** ⇒ مخزونٌ فعلاً، وتنظيفُه عملٌ مشروع ⇒ **طبيعيّ**.
      //   • غيرُ مستخدَمٍ **ومُفعَّلٌ في الساس** ⇒ 🔴 **أخطرُ الحالات**: كارتٌ خدم مشتركاً
      //     والبرنامجُ لا يعرف، فلا وصلَ ولا دَين — وحذفُه يمحو آخرَ أثرٍ له.
      if (!serial || row.agentId == null) {
        verdict = "error";
        info = "بلا سيريالٍ أو بلا وكيل — لا سبيلَ للفحص";
      } else {
        const list = await sessionsFor(row.agentId);
        let hit: Awaited<ReturnType<typeof sasSearchActivation>> = null;
        for (const s of list) {
          hit = await sasSearchActivation(s.base, s.token, serial);
          if (hit) break;
        }
        if (!hit) {
          if (row.useDate == null) {
            // مخزونٌ حقيقيٌّ حُذف — لا مالَ ولا مشترك. وهذا **طبيعيٌّ** فلا يُزعَج به المالك.
            verdict = "normal";
            info = "غيرُ مستخدَمٍ ولا تفعيلَ له في الساس — مخزونٌ حُذف، لا أثرَ ماليّ";
          } else {
            // ⚠️ البرنامجُ يقول «مستخدَم» والساسُ لا يعرفه. ولا يُحكَم بالوهميّة:
            //   درسُ ٢٠٢٦-٠٨-١٣ أنّ قائمةَ الساس الجماعيّةَ أخفت ٧٤ تفعيلاً حقيقيّاً،
            //   وأنّ **غيابَ الدليل ليس دليلَ غياب**. فيُبلَّغ ليُقرِّرَ المالكُ لا ليُحذَف.
            verdict = "used-not-in-sas";
            info = "البرنامجُ يقول مستخدَمٌ ولا تفعيلَ له في الساس — يحتاج قرارَك (ولا يُحكَم بالوهميّة)";
          }
        } else {
          info = `الساس: ${hit.username ?? "?"} · ${hit.method ?? "?"} · ${hit.createdAt ?? "?"}`;
          if (row.useDate == null) {
            // 🔴 مُفعَّلٌ في الساس والبرنامجُ يحسبه مخزوناً ⇒ خدمةٌ بلا وصلٍ ولا دَين
            verdict = "sold-unrecorded";
            info = `🔴 غيرُ مستخدَمٍ في البرنامج ومُفعَّلٌ في الساس — ${info}`;
            // ولا حاجةَ للبحث عن وصلٍ: البرنامجُ لا يعرف الاستخدامَ أصلاً فلا مشتركَ يُربَط به.
            //   والختمُ والإبلاغُ في ذيلِ الحلقة — مسارٌ واحدٌ لكلّ الأحكام.
          } else {
            // وصلُ القبض: تفعيلٌ للمشترك بمبلغٍ مقبوضٍ قرب تاريخ تفعيل الساس (±٣ أيّام —
            // فتاريخُ الإدخال قد يختلف عن تاريخ الساس بيومٍ أو يومَين)
            const when = hit.createdAt ? new Date(hit.createdAt) : null;
            const entry = row.subscriberId != null && when && !isNaN(when.getTime())
              ? await prisma.subscriptionEntry.findFirst({
                  where: {
                    subscriberId: row.subscriberId, isDeleted: false,
                    date: { gte: new Date(when.getTime() - 3 * 86400_000), lte: new Date(when.getTime() + 3 * 86400_000) },
                  },
                  select: { id: true, moneyIn: true, money: true, dateFrom: true, dateTo: true },
                })
              : null;
            // 🔴 **تصحيحُ محمد**: وجودُ الوصل يكفي — والتفعيلُ على الدَّين وصلُه بمبلغٍ
          //   مقبوضٍ صفرٍ والمالُ في دَين المشترك، فليس خطراً. وكان الشرطُ `moneyIn > 0`
          //   فيظلم كلَّ تفعيلٍ على الدَّين (قِيس ٤٤ كارتاً من ٥٨ في نظير هذا الفحص).
          if (entry) {
              const onDebt = (entry.moneyIn ?? 0) <= 0 && (entry.money ?? 0) > 0;
            info += onDebt
              ? ` · وصلٌ #${entry.id} **على الدَّين** بمبلغ ${entry.money}`
              : ` · وصلٌ #${entry.id} بمبلغ ${entry.moneyIn}`;
            // ═══ مدّةُ التفعيل: مقلوبةٌ أو صفرٌ ⇒ سجلٌّ مضطربٌ يُبلَّغ (طلبُ محمد 2026-08-14) ═══
            //   وأصلُه صفٌّ حقيقيٌّ رُئي في تدقيق الـ٧٤: `bg-5-23-1@mu` مدّتُه **−٥** لا ٣١،
            //   أي أنّ تاريخَ الانتهاء **أقدمُ من البداية**. والمالُ مقبوضٌ والتفعيلُ ثابت،
            //   فالخللُ في الورقة لا في المال — ومع ذلك **يُبلَّغ**: مشتركٌ دفع ولا مدّةَ له.
              const days = entry.dateFrom && entry.dateTo
                ? Math.round((entry.dateTo.getTime() - entry.dateFrom.getTime()) / 86400_000)
                : null;
              if (days != null && days <= 0) {
                verdict = "bad-duration";
                info += ` · ⚠️ مدّةٌ ${days} يوماً (الانتهاءُ أقدمُ من البداية)`;
              } else {
                verdict = "normal";
                if (days != null) info += ` · ${days} يوماً`;
              }
            } else {
              verdict = "no-receipt";
              info += " · **بلا أيّ وصلٍ — لا قبضاً ولا دَيناً**";
            }
          }
        }
      }
    } catch (e) {
      verdict = "error";
      info = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    }
    // الحَجزُ قبل الأثر: لا يُحكَم مرّتَين ولا يُبلَّغ مرّتَين
    const claimed = await prisma.deletedCardLog.updateMany({
      where: { id: row.id, verdict: "pending" },
      data: { verdict, verdictAt: new Date(), sasInfo: info.slice(0, 500) },
    });
    if (claimed.count !== 1) continue; // فحصٌ آخرُ سبقنا إليه
    if (verdict === "normal") continue;
    out.critical++;
    // 🔔 «وإن كان الأمرُ به شيءٌ غيرُ طبيعيٍّ فيُبلِّغ بالحالة» — إشعارٌ للمالك فوراً
    const label: Record<string, string> = {
      "sold-unrecorded": "🔴 كارتٌ يحسبه البرنامجُ مخزوناً وهو **مُفعَّلٌ في الساس** — خدمةٌ بلا وصلٍ ولا دَين",
      "used-not-in-sas": "كارتٌ مستخدَمٌ في البرنامج بلا تفعيلٍ في الساس — يحتاج قرارَك",
      "bad-duration": "تفعيلٌ بمدّةٍ مقلوبةٍ أو صفر — المالُ مقبوضٌ ولا مدّةَ للمشترك",
      "no-receipt": "كارتٌ مُفعَّلٌ في الساس **بلا وصلِ قبض**",
      "error": "تعذّر فحصُ كارتٍ محذوف",
    };
    await notify({
      agentId: row.agentId, towerId: row.towerId, type: "card-guard",
      title: "🛡️ حارسُ المال: حالةُ كارتٍ محذوف",
      body: `${label[verdict] ?? verdict} — سيريال ${serial || "؟"}${row.price ? ` · ${row.price.toLocaleString("en-US")} د.ع` : ""}
${info}`,
      refType: "deletedCardLog", refId: row.id, url: "/manager-accounts",
    });
  }
  return out;
}
