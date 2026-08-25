// ═════ البند ٤-ب · «فعّل بنفسه» — رسالةٌ وطابورٌ (طلبُ محمد 2026-08-13) ═════
//
// طلبُه: «المشتركُ الذي فعّل اشتراحه بنفسه (لا الوكيل) — يُعرَف من الـmanager: إن كان
// manager في الساس نفسَ اسم حساب المكتب ⇒ الوكيلُ فعّله، وإن كان غيرَه ⇒ فعّل بنفسه.
// ⇒ قالبٌ جديدٌ يُرسَل له عند المزامنة، **وطابورٌ إن كان الواتساب لا يعمل**:
//   • الطابورُ يُرسَل عند اشتغال الحاسبة والواتساب.
//   • **ويُمسَح إن مرّت ٢٤ ساعةً ولم يُفتَح واتساب المكتب.»**
//
// 🎯 **والتفريقُ صار مقيساً لا مُفترَضاً**: فحصُ الساس الحيُّ (2026-08-13) أظهر أنّ تفعيلاتِ
//   المواصلات كلَّها باسم `FDT13-MU` — وهو موقعُ المشترك حين يُفعّل من **تطبيق سوبر سيل**،
//   بينما تفعيلاتُ الشدن كلُّها باسم حساب المكتب `Ahmad.Qasem@MLH`. فالقاعدةُ التي وصفها
//   محمد صحيحةٌ على بياناتٍ حقيقيّة.
//
// 🔑 **ولماذا لا `wa_relays`؟** راجعتُه كما طلب محمد: **يُنظَّف كلُّ صفٍّ أقدمَ من خمس
//   دقائق** (`whatsapp.ts`) — فهو طابورُ نداءٍ لحظيٍّ لا طابورُ رسائلَ لأربعٍ وعشرين ساعة.
//   ⇒ فالطابورُ هو **جدولُ الرسائل نفسُه** بحالة `PENDING` (قيمةٌ قائمةٌ في `MessageStatus`
//     وعليها فهرس): بلا جدولٍ جديدٍ، **والطابورُ يُرى في سجلّ الرسائل** الذي يفتحه محمد
//     أصلاً — فلا صندوقَ أسودَ يُشتكى منه لاحقاً.
import { prisma } from "@/lib/prisma";
import { getEffectiveTemplateFull } from "@/lib/smsTemplates";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { formatExpiryOrEmpty } from "@/lib/format";
import { isWaBusy } from "@/lib/waGate"; // 🚦 «لم يحن دورُه» ≠ فشلُ إرسال

/** بعدها يُمسَح الصفُّ المعلَّق ولا يُرسَل (نصُّ الطلب: «إن مرّت ٢٤ ساعةً ولم يُفتَح واتساب»). */
export const SELF_ACT_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;

// ═════ 🔴 حادثةُ 2026-08-14 19:16 — «أين ذهبت مهلةُ العشر ثوانٍ؟» (بلاغُ محمد) ═════
// ١٧٦ رسالةَ بثٍّ لمكتب الرسالة خرجت في ~٤ دقائق بمتوسّط **١٫١ ثانيةٍ** بينها. والسببُ أنّ
// هذه الدالّةَ — وهي على **كلّ حاسبة مكتب** وتُنادى كلَّ دورةِ مجدولٍ وعند جهوزيّة الواتساب —
// كانت تلتقط **كلَّ** صفٍّ `PENDING` لمشتركي مكتبها بلا تمييزِ مصدره، وترسله **بلا أيّ
// فاصل**. فخطفت طابورَ البثّ من ساحبه السحابيِّ ذي الفاصل العشريّ، وأخرجته رشقةً واحدة.
// 🔴 والخطرُ ليس تجميليّاً: رشقةٌ كهذه سببٌ مباشرٌ لحظر رقم الواتساب.
//
// ⇒ إصلاحان لا واحد:
//   ١. **العزل**: لا تأخذ إلّا صفوفَها هي (`createdByUser = "sync"`) — فطابورُ البثّ
//      (وسمُه `createdByUser` = اسمُ المُرسِل، وعلامتُه في `error`) يبقى لساحبه وحدَه.
//   ٢. **فاصلٌ وحارس**: فاصلٌ بين رسالةٍ وأخرى حتى لصفوفها هي، وحارسُ تشغيلٍ واحدٍ لكلّ
//      مكتب — فهي تُنادى كلَّ دقيقة، وبلا حارسٍ تتراكب النسخُ فيعود التوازي من بابٍ آخر.
const SELF_ACT_BATCH = 30;      // سقفُ الدورة الواحدة (٣٠ × ١٠ث = ٥ دقائق) والباقي في التالية
const draining = new Set<number>(); // مكاتبُ يجري تصريفُها الآن (حارسُ عدم التراكب)

/**
 * يُبلِّغ مشتركاً فعّل اشتراكه بنفسه. يُنادى من المزامنة لكلّ تفعيلٍ **مُفعِّلُه ليس
 * حسابَ المكتب**. لا يرمي استثناءً أبداً — مزامنةُ المكتب أهمُّ من رسالة.
 *
 * @param dateTo تاريخُ الانتهاء الناتجُ عن هذا التفعيل — وهو **هويّةُ الحدث** وختمُه.
 */
export async function notifySelfActivated(
  subscriberId: number,
  dateTo: Date | null,
): Promise<"sent" | "queued" | "skipped"> {
  try {
    if (!dateTo || isNaN(dateTo.getTime())) return "skipped"; // بلا تاريخٍ لا هويّةَ للحدث ⇒ لا ختمَ يُعتمد
    const sub = await prisma.subscriber.findUnique({
      where: { id: subscriberId },
      select: {
        id: true, name: true, netUser: true, phone: true, waEnabled: true, isDeleted: true,
        towerId: true, packageId: true, carry: true, rewardCode: true, rewardBalance: true,
        selfActNoticeAt: true,
      },
    });
    if (!sub || sub.isDeleted || !sub.waEnabled || !sub.phone) return "skipped";
    if (sub.towerId == null) return "skipped";

    // ═══ الحَجزُ قبل الأثر: ختمٌ ذرّيٌّ بتاريخ هذا التفعيل ═══
    // المزامنةُ تُعيد قراءةَ تفعيلاتِ الأمس في **كلّ دورة** — فبلا ختمٍ تُرسَل الرسالةُ
    // كلَّ دورةٍ إلى الأبد (وهي عينُ حادثة تكرار رسائل الشدن). والشرطُ «ختمٌ مختلف»
    // يجعل تفعيلاً جديداً (تاريخٌ جديد) يمرّ، وإعادةَ قراءةِ القديم لا تمرّ.
    const claimed = await prisma.subscriber.updateMany({
      where: {
        id: sub.id,
        OR: [{ selfActNoticeAt: null }, { selfActNoticeAt: { not: dateTo } }],
      },
      data: { selfActNoticeAt: dateTo },
    });
    if (claimed.count !== 1) return "skipped"; // أُبلِغ عن هذا التفعيل سلفاً

    const office = await prisma.tower.findUnique({
      where: { id: sub.towerId },
      select: { id: true, name: true, agentId: true, waEnabled: true },
    });
    if (!office || office.waEnabled === "0") return "skipped";
    const tpl = await getEffectiveTemplateFull("selfActivated", office.agentId, office.id);
    if (!tpl) return "skipped"; // القالبُ مُعطَّل

    const pkg = sub.packageId != null
      ? await prisma.package.findUnique({ where: { id: sub.packageId }, select: { name: true, priceDinar: true } })
      : null;
    const text = renderTemplate(tpl.text, {
      name: sub.name, netUser: sub.netUser, phone: sub.phone,
      package: pkg?.name ?? "", price: pkg?.priceDinar ?? 0,
      dateTo: formatExpiryOrEmpty(dateTo),
      carry: sub.carry ?? 0, remaining: sub.carry ?? 0,
      code: sub.rewardCode, balance: sub.rewardBalance ?? 0,
      office: office.name ?? "",
    });

    const res = await sendViaProvider("WHATSAPP", sub.phone, text, sub.towerId, tpl.image, "bulk");
    if (res.ok) {
      await prisma.message.create({
        data: {
          channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
          status: "SENT", agentId: office.agentId, createdByUser: "sync",
        },
      });
      return "sent";
    }
    // ═══ الطابور: واتسابُ المكتب لا يعمل الآن ⇒ صفٌّ معلَّقٌ يُستأنَف حين يعمل ═══
    // 🔑 و`agentId` و`towerId` عبر المشترك: الاستئنافُ لا يُرسِل رسالةَ مكتبٍ من واتساب
    //   مكتبٍ آخر — والعزلُ لا يكون بحُسن النيّة.
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
        status: "PENDING", error: res.error ?? "واتساب المكتب غير متصل — بالطابور",
        agentId: office.agentId, createdByUser: "sync",
      },
    });
    return "queued";
  } catch {
    return "skipped"; // لا يُفشل المزامنةَ تعذُّرُ رسالة
  }
}

/**
 * تصريفُ الطابور: يُرسل المعلَّقاتِ لمكتبٍ صار واتسابُه جاهزاً، ويمسح ما مضى عليه
 * أكثرُ من أربعٍ وعشرين ساعة (نصُّ الطلب).
 *
 * 🔑 **والحَجزُ قبل الأثر هنا أيضاً**: كلُّ صفٍّ يُقلَب `SENT` **قبل** الإرسال بشرط أنّه
 *   ما زال `PENDING`. فالخاسرُ في السباق لا يُرسل نسخةً ثانية — ولو خُتم بعد الإرسال
 *   لَأرسلت حاسبتان معاً نسختَين لكلّ مشترك (درسُ الشدن: ٤ نسخ).
 * ⚠️ وثمنُه المعروف: رسالةٌ فشل إرسالُها بعد الختم تُسجَّل `FAILED` ولا يُعاد إرسالُها —
 *   وهو المقصود، فالبديلُ محاولةٌ أبديّةٌ تُغرق المشترك.
 */
export async function drainSelfActivatedQueue(towerId: number): Promise<{ sent: number; expired: number; failed: number; waiting: number }> {
  const out = { sent: 0, expired: 0, failed: 0, waiting: 0 };
  if (draining.has(towerId)) return out; // دورةٌ سابقةٌ ما زالت تعمل لهذا المكتب
  draining.add(towerId);
  try {
    const cutoff = new Date(Date.now() - SELF_ACT_QUEUE_TTL_MS);
    // 🔑 و`Message` **بلا علاقةٍ** إلى `Subscriber` (فيه `subscriberId` مجرَّداً)، فلا يصحّ
    //   الترشيحُ بـ`subscriber: { towerId }`. والطابورُ صغيرٌ بطبعه (معلَّقاتٌ فقط)، فيُجلَب
    //   ثمّ يُنسَب كلُّ صفٍّ لمكتبه بمعرّف مشتركه — 🔒 وهو موضعُ العزل: لا تُرسَل رسالةُ
    //   مشتركٍ من واتساب مكتبٍ ليس مكتبَه.
    const all = await prisma.message.findMany({
      // 🔒 **صفوفُها هي حصراً**: `createdByUser: "sync"` هو وسمُ ما تُنشئه هذه الميزةُ أعلاه.
      //   وبلا هذا الشرط كانت تخطف طابورَ البثّ فتُخرجه رشقةً (حادثةُ ١٧٦ رسالة).
      where: { status: "PENDING", channel: "WHATSAPP", subscriberId: { not: null }, createdByUser: "sync" },
      select: { id: true, phone: true, text: true, date: true, subscriberId: true },
      orderBy: { id: "asc" },
      take: 1000,
    });
    if (!all.length) return out;
    const subIds = [...new Set(all.map((m) => m.subscriberId!).filter((x) => Number.isFinite(x)))];
    const mine = new Set(
      (await prisma.subscriber.findMany({
        where: { id: { in: subIds }, towerId, isDeleted: false },
        select: { id: true },
      })).map((s) => s.id),
    );
    const ours = all.filter((m) => m.subscriberId != null && mine.has(m.subscriberId));

    // ١) مسحُ ما تجاوز ٢٤ ساعة (نصُّ الطلب: «يُمسَح إن مرّت ٢٤ ساعةً ولم يُفتَح واتساب»)
    const stale = ours.filter((m) => m.date < cutoff);
    if (stale.length) {
      await prisma.message.deleteMany({ where: { id: { in: stale.map((m) => m.id) } } });
      out.expired = stale.length;
    }
    // ٢) إرسالُ الباقي — سقفُ الدورة والباقي في التالية، **وبفاصلٍ بين رسالةٍ وأخرى**
    const pend = ours.filter((m) => m.date >= cutoff).slice(0, SELF_ACT_BATCH);
    // 🖼️ صورةُ القالب تُقرأ **مرّةً** لهذا المكتب وتُرسَل مع كلّ رسالةٍ في الدورة —
    //    فصفُّ الطابور يخزّن النصَّ وحدَه، وكانت رسائلُه تصل بلا صورةٍ أبداً (2026-08-22).
    let queueImage: string | null = null;
    try {
      const t = await prisma.tower.findUnique({ where: { id: towerId }, select: { agentId: true } });
      const tpl = await getEffectiveTemplateFull("selfActivated", t?.agentId ?? null, towerId);
      queueImage = tpl?.image ?? null;
    } catch { /* بلا صورةٍ خيرٌ من إسقاط الطابور */ }
    for (const m of pend) {
      if (!m.phone) { await prisma.message.deleteMany({ where: { id: m.id } }); continue; }
      // ⏱️ الفاصلُ **قبل** كلّ رسالةٍ عدا الأولى — فلا رشقةَ تُعرّض الرقمَ للحظر
      // 🚦 (أُزيل الفاصلُ المحلّيّ 2026-08-25) — الفاصلُ الآن واحدٌ على الرقم في `waGate`
      // الحَجزُ قبل الأثر
      const claim = await prisma.message.updateMany({
        where: { id: m.id, status: "PENDING" },
        data: { status: "SENT", error: null },
      });
      if (claim.count !== 1) continue;
      const res = await sendViaProvider("WHATSAPP", m.phone, m.text, towerId, queueImage, "bulk");
      if (res.ok) out.sent++;
      else if (isWaBusy(res.error)) {
        // 🚦 «لم يحن دورُه على الرقم» — **لم تخرج رسالةٌ إطلاقاً**، فيعود الصفُّ معلَّقاً
        //    ليأخذه التصريفُ التالي. وبلا هذا الاستثناء كان الازدحامُ اللحظيُّ يُعدَم الرسالةَ
        //    نهائيّاً (الصفُّ يُختَم فاشلاً ولا يُعاد إرسالُه أبداً — بحكم الحَجز قبل الأثر).
        out.waiting++;
        await prisma.message.updateMany({ where: { id: m.id }, data: { status: "PENDING", error: null } });
      }
      else {
        out.failed++;
        await prisma.message.updateMany({ where: { id: m.id }, data: { status: "FAILED", error: res.error ?? "فشل الإرسال من الطابور" } });
      }
    }
  } catch { /* الطابورُ مكسبٌ لا واجبٌ يُخاطَر لأجله */ } finally {
    draining.delete(towerId); // يُحرَّر دائماً — وإلّا تجمّد تصريفُ المكتب إلى الأبد
  }
  return out;
}
