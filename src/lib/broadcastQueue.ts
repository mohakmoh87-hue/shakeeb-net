import { prisma } from "@/lib/prisma";

// ═════════ ب-٢ · طابورُ الإرسال الجماعيّ — مخزَّنٌ في القاعدة ويُستأنف ═════════
//
// 🔴 الحادثة (بثّ الشدن 2026-08-10): حلقةُ الإرسال كانت **مفصولةً في ذاكرة الحاوية** —
//   ٢٤٤٧ مستلماً × ١٠ ثوانٍ ≈ ٧ ساعات، وأيُّ نشرةٍ/إقلاعٍ يقتلها صامتاً. ماتت عند
//   ٤١٦/٢٤٤٧ **ولا أثرَ للبقيّة إطلاقاً** — فالصفوفُ كانت تُكتب بعد كلّ محاولةٍ لا قبلها.
//
// ⇒ **الطابورُ هو جدولُ `messages` نفسُه**: البثُّ يكتب كلَّ المستلمين صفوفاً `PENDING`
//   دفعةً (فالمتبقّي محفوظٌ مهما حدث)، وهذا الساحبُ يجرّها واحدةً واحدةً — ويُستأنف عند
//   إقلاع الموقع تلقائيّاً (instrumentation) فلا يضيع بثٌّ بعد اليوم.
//
// 🔒 دروسُ الحوادث مُطبَّقة:
//   · «لا استطلاعَ بلا حَجزٍ ذرّيّ» (تكرار واتساب الشدن): الحَجزُ بعبارةٍ واحدةٍ
//     `FOR UPDATE SKIP LOCKED` — حاويتان متراكبتان لحظةَ نشرٍ لا تُرسلان صفّاً مرّتَين.
//   · العلامةُ في `error` (لا حالةَ `SENDING` في التعداد — ولا مهاجرةَ لأجل علامة):
//     `⏳ قيد الإرسال` أثناء الحمل، وتُمحى بالنتيجة. والعالقةُ (انهيارٌ وسط الإرسال)
//     تُحرَّر عند الإقلاع إن قدُمت عن ١٠ دقائق.
//   · حاسبةُ المكتب مطفأة ⇒ الصفُّ **يبقى منتظراً** لا يُختَم فاشلاً — فالبثُّ يُكمل
//     نفسَه حين تعود. والمنتظرُ فوق ٤٨ ساعةً يُختَم فاشلاً بسببٍ مقروءٍ كي لا يخلد.

/** علامةُ الاصطفاف — تُكتب في `error` لحظةَ الإدراج (مسارُ الرسائل يضعها مع createMany).
 *  🔴 وهي **درعُ الطابور من مقصلة المجدول**: `cancelUnsentMessages` على الحاسبات كانت تُلغي
 *  كلَّ PENDING بلا استثناء (سياسة «محاولة واحدة» القديمة) — فذبحت بثَّ ١٧٦ رسالةً لمكتب
 *  الرسالة في أوّل دقيقةٍ بعد عودة الحاسبات (2026-08-14 18:45). صارت المقصلةُ تحصد فقط
 *  ما `error IS NULL` (يتامى النمط القديم)، وصفوفُ الطابور موسومةٌ فلا تُمَسّ. */
export const QUEUE_MARK = "📤 في طابور البثّ";
const CLAIM_MARK = "⏳ قيد الإرسال";
const GAP_MS = 10_000;          // فاصلُ مكافحة الحظر بين رسالةٍ وأخرى (كما كان)
const OFFLINE_RETRY_MS = 60_000; // الحاسبةُ مطفأة: هدأةٌ قبل المحاولة التالية
const EXPIRE_H = 20;            // المنتظرُ فوقها يُختَم فاشلاً — ٢٠ ساعة (طلبُ محمد 2026-08-19: «يُمحى بعد ٢٠ ساعة لا ٤٨»)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Claimed = { id: number; subscriberId: number | null; phone: string | null; text: string; templateType: string | null };

/** حَجزُ أقدمِ صفٍّ معلّقٍ ذرّيّاً — عبارةٌ واحدة، فلا يلتقطه ساحبان أبداً. */
async function claimNext(): Promise<Claimed | null> {
  const rows = await prisma.$queryRaw<Claimed[]>`
    UPDATE messages SET error = ${CLAIM_MARK}, "updatedAt" = now()
     WHERE id = (
       SELECT id FROM messages
        WHERE channel = 'WHATSAPP' AND status = 'PENDING' AND error = ${QUEUE_MARK}
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
     RETURNING id, "subscriberId", phone, text, "templateType"`;
  return rows[0] ?? null;
}

async function releaseClaim(id: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE messages SET error = ${QUEUE_MARK}, "updatedAt" = now()
     WHERE id = ${id} AND status = 'PENDING' AND error = ${CLAIM_MARK}`;
}

/** صيانةُ الإقلاع: تحريرُ حجوزاتٍ علِقت بانهيارٍ + إفشالُ ما شاخ في الانتظار. */
async function recover(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE messages SET error = ${QUEUE_MARK}, "updatedAt" = now()
     WHERE channel = 'WHATSAPP' AND status = 'PENDING' AND error = ${CLAIM_MARK}
       AND "updatedAt" < now() - interval '10 minutes'`.catch(() => {});
  await prisma.$executeRaw`
    UPDATE messages SET status = 'FAILED', error = ${"انتظر أكثر من " + EXPIRE_H + " ساعة ولم تتّصل حاسبة مكتبه — أعد إرساله إن شئت"}, "updatedAt" = now()
     WHERE channel = 'WHATSAPP' AND status = 'PENDING'
       AND date < now() - (${EXPIRE_H} * interval '1 hour')`.catch(() => {});
}

async function drainLoop(): Promise<void> {
  await recover();
  // 🖼️ صورةُ القالب لكلّ (نوع، مكتب) — تُحمَّل مرّةً وتُخزَّن لعمر الدورة
  const imgCache = new Map<string, string | null>();
  const imageFor = async (templateType: string | null, towerId: number | null, agentId: number | null): Promise<string | null> => {
    if (!templateType || towerId == null) return null;
    const k = `${templateType}:${towerId}`;
    if (imgCache.has(k)) return imgCache.get(k)!;
    let img: string | null = null;
    try {
      const { getEffectiveTemplateFull } = await import("@/lib/smsTemplates");
      img = (await getEffectiveTemplateFull(templateType, agentId, towerId))?.image ?? null;
    } catch { img = null; }
    imgCache.set(k, img);
    return img;
  };
  for (;;) {
    const job = await claimNext();
    if (!job) return; // الطابورُ فرغ — ينام حتى ركلةٍ قادمة (بثٌّ جديدٌ أو دوريّةٌ أو إقلاع)

    let outcome: { ok: boolean; error?: string };
    try {
      if (!job.phone) outcome = { ok: false, error: "لا يوجد رقم هاتف" };
      else {
        // مكتبُ المشترك لحظةَ الإرسال (لا لحظةَ الاصطفاف) — نقلُ مشتركٍ بين مكتبين لا يضيّع رسالته
        const sub = job.subscriberId != null
          ? await prisma.subscriber.findUnique({ where: { id: job.subscriberId }, select: { towerId: true } })
          : null;
        const towerId = sub?.towerId ?? null;
        const office = towerId != null
          ? await prisma.tower.findUnique({ where: { id: towerId }, select: { agentId: true } })
          : null;
        const { sendWhatsApp } = await import("@/lib/whatsapp");
        // 🖼️ صورةُ القالب المختار ترافق رسائلَ البثّ أيضاً (كانت مؤجَّلةً حتى عمود templateType)
        const image = await imageFor(job.templateType, towerId, office?.agentId ?? null);
        outcome = await sendWhatsApp(towerId, job.phone, job.text, image);
      }
    } catch (e) {
      outcome = { ok: false, error: e instanceof Error ? e.message : "خطأ غير متوقّع" };
    }

    // الحاسبةُ مطفأةٌ/الجلسةُ غيرُ متّصلةٍ أو غيرُ جاهزة ⇒ ليس فشلَ الرسالة بل غيابَ الناقل:
    // يبقى الصفُّ منتظراً ويُستأنف حين تتّصل — وهذا جوهرُ «طابورٍ يُستأنف» الذي طلبه محمد.
    // («غير جاهز» أضيفت بعد حادثة 18:32: أثناء إعادة تشغيل الحاسبات تمرّ الجلسةُ بحالات
    //  starting/qr فيردّ المُرحِّلُ «غير جاهز (الحالة: X)» — وهي عابرةٌ لا فشلُ رقم.)
    const offline = !outcome.ok && /غير مشغّلة|غير متصل|غير جاهز/.test(outcome.error ?? "");
    if (offline) {
      await releaseClaim(job.id).catch(() => {});
      await sleep(OFFLINE_RETRY_MS);
      continue;
    }

    await prisma.message.update({
      where: { id: job.id },
      data: { status: outcome.ok ? "SENT" : "FAILED", error: outcome.ok ? null : (outcome.error ?? "تعذّر الإرسال") },
    }).catch(() => {});
    await sleep(GAP_MS);
  }
}

// ساحبٌ واحدٌ لكلّ عمليّة — والركلُ آمنُ التكرار (يتجاهَل إن كان يعمل)
const g = globalThis as unknown as { __broadcastDrainer?: boolean };
export function kickBroadcastDrainer(reason: string): void {
  if (g.__broadcastDrainer) return;
  g.__broadcastDrainer = true;
  console.log(`[broadcast] الساحبُ انطلق (${reason})`);
  void drainLoop()
    .catch((e) => console.error("[broadcast] الساحبُ سقط:", e instanceof Error ? e.message : e))
    .finally(() => { g.__broadcastDrainer = false; });
}
