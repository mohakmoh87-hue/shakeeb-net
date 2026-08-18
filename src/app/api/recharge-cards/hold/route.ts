import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

const schema = z.object({ cardId: z.coerce.number() });

// ═════ 🔴 «الكارت يرجع للمخزن قبل أن أضغط حفظ» (بلاغُ محمد 2026-08-19) ═════
//
// حجزُ الكارت ينتهي بعد **٥ دقائق** (`staleBefore` في مسار السحب)، وهي مدّةٌ كافيةٌ
// لمن يُفعّل من البرنامج مباشرةً — لكنّ مَن يُفعّل **على لوحة الساس أوّلاً** ثمّ يعود
// ليحفظ يتجاوزها كثيراً (والساسُ بطيء). فينتهي الحجزُ **والنافذةُ مفتوحةٌ أمامه**،
// فيلتقط كارتَه أوّلُ ساحبٍ آخر ⇒ «رجع للمخزن» وهو ما يزال يعمل عليه.
//
// 🔑 وهذا المسارُ ينبض بالحجز: ما دامت نافذةُ التفعيل مفتوحةً يبقى الكارتُ محجوزاً،
//   وحين تُغلق (أو يُغلق المتصفّح) تتوقّف النبضةُ فينتهي الحجزُ وحدَه بعد ٥ دقائق —
//   فلا كارتَ يُحبَس إلى الأبد، ولا كارتَ يُسحَب من يدِ عاملٍ عليه.
//
// ⚠️ ولا يُنعِش كارتاً استُهلك (`useDate` غيرُ فارغ) ولا كارتَ وكيلٍ آخر (عزل).
export async function POST(request: Request) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  // 🔒 والشرطُ `reservedBy` هو صاحبُ الجلسة: لا يُجدِّد أحدٌ حجزَ كارتٍ حجزه غيرُه —
  //    وإلّا صارت هذه النقطةُ وسيلةً لتثبيت كارتِ زميلٍ عليه إلى الأبد.
  const done = await prisma.rechargeCard.updateMany({
    where: {
      id: parsed.data.cardId,
      useDate: null,
      agentId: g.session?.agentId ?? -1,
      reservedBy: g.session?.userId ?? -1,
    },
    data: { reservedAt: new Date() },
  });
  // `held: false` ⇒ ضاع الحجز (انتهى وأخذه غيرُك، أو استُهلك) — والواجهةُ تُنبّه
  return NextResponse.json({ ok: true, held: done.count === 1 });
}
