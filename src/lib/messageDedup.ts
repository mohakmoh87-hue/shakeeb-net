import { prisma } from "@/lib/prisma";

// ═════════ حارسُ تكرار الرسائل (طلبُ محمد 2026-08-19) ═════════
//
// «في حالة قام مدير مكتب او مستخدم بارسال رسائل الى كل او قسم من المشتركين فان بسبب خللٍ
//  معيّنٍ ممكن ان تتكرّر الرسائل فتذهب رسالتان الى نفس المشترك … رسالةٌ واحدةٌ من كلّ قالبٍ
//  خلال ٢٤ ساعة … واريد حارساً منيعاً جدّاً.»
//
// 🔑 والأمنعُ حارسٌ على مستوى القاعدة: فهرسٌ فريدٌ جزئيٌّ على `dedupKey` (يُنشأ بسكربت
//   ما-قبل-النشر). فيستحيل **فيزيائيّاً** وجودُ رسالتَين لنفس (الوكيل·المشترك·القالب·يومِ
//   بغداد) مهما تكرّر الطلبُ أو تسابقت الحاسباتُ أو أعاد الساحبُ المحاولة — لا فحصٌ في
//   الكود يُخدَع، بل قيدٌ في القاعدة لا يُخترَق.
//
// وله بابان بحسب طبيعة المسار:
//   · مساراتُ **الطابور** (تُدرَج PENDING ثمّ يُرسل الساحب): الفهرسُ + `skipDuplicates`
//     (‏ON CONFLICT DO NOTHING) ⇒ الصفُّ المكرَّرُ لا يُدرَج فلا يُرسَل أصلاً. أمنعُ ما يكون.
//   · المساراتُ **الفوريّة** (تُرسل ثمّ تُسجَّل): الفحصُ **قبل** الإرسال بـ`alreadySentToday`
//     — فالإدراجُ متأخّرٌ عن الإرسال. والفهرسُ يبقى شبكةَ أمانٍ للسجلّ.

// يومُ بغداد (الخادمُ UTC، وبغداد +3): سلسلةُ YYYY-MM-DD — بها يُبنى مفتاحُ اليوم.
export function baghdadDayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

// مفتاحُ منعِ التكرار. `null` ⇒ لا يُدَّدَع أبداً (رسائلُ بلا مشترك: تقاريرُ المدير والمزامنة —
// فوضعُها في الفهرس كان سيمنع تقريرَين في اليوم). و«bulk» للبثّ العامّ بلا قالبٍ مختار.
// 🔒 العزل: الوكيلُ جزءٌ من المفتاح، فلا يتصادم مشتركا وكيلَين لهما نفسُ المعرّف نظريّاً.
export function messageDedupKey(
  agentId: number | null | undefined,
  subscriberId: number | null | undefined,
  templateType: string | null | undefined,
): string | null {
  if (subscriberId == null) return null;
  const t = (templateType && templateType.trim()) || "bulk";
  return `${agentId ?? 0}:${subscriberId}:${t}:${baghdadDayKey()}`;
}

// المساراتُ الفوريّة: هل أُرسِل هذا القالبُ لهذا المشترك خلال ٢٤ ساعة؟ (قبل الإرسال).
// 🔒 العزلُ محفوظٌ مرّتَين: المشتركُ يتبع وكيلاً واحداً، ويُضاف `agentId` تأكيداً.
// والحالتان SENT/PENDING تُحسبان «مُرسَلاً»: PENDING رسالةٌ في الطابور ستُرسَل، فعدُّها يمنع
// إدراجَ ثانيةٍ بجانبها.
export async function alreadySentToday(
  subscriberId: number,
  templateType: string,
  agentId: number | null | undefined,
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const hit = await prisma.message
    .findFirst({
      where: {
        subscriberId,
        templateType,
        channel: "WHATSAPP",
        status: { in: ["SENT", "PENDING"] },
        date: { gte: since },
        ...(agentId != null ? { agentId } : {}),
      },
      select: { id: true },
    })
    .catch(() => null);
  return !!hit;
}
