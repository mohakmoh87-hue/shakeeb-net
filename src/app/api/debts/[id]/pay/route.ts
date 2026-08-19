import { NextResponse } from "next/server";
import { requireTower } from "@/lib/requireTower";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { getEffectiveTemplateFull } from "@/lib/smsTemplates";

const schema = z.object({
  // ب-٠٠ · جذرُ الكسر: لا كسورَ في الدينار العراقي، وتسديدٌ بكسرٍ يُخلّف ديناً كسريّاً لا يُسدَّد أبداً
  amount: z.coerce.number().int("المبلغ يجب أن يكون عدداً صحيحاً — لا كسور في الدينار العراقي").positive("المبلغ يجب أن يكون أكبر من صفر"),
  master: z.boolean().optional(), // تسديد على حساب الماستر بدل الصندوق النقدي
});

// تسديد دين مشترك: يقلّل الدين + يسجّل قبضاً في الصندوق
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("finance.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  const subscriberId = Number(id);
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { amount, master } = parsed.data;

  const subscriber = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
  });
  if (!subscriber || subscriber.isDeleted || !(await sameAgentTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  // ===== ب-٠٠ · الحرجة ١: تسديدٌ يتجاوز الدين ⇒ **رصيدٌ للمشترك لا صفر** =====
  // كان `Math.max(0, …)` يقصّ الزائدَ: مَن عليه ٥٠٬٠٠٠ ودفع ٦٠٬٠٠٠ يصير دَينُه صفراً
  // **والعشرةُ آلافٍ تختفي** — دخلت الصندوقَ ولا أثرَ لها عند المشترك. وهو مالُ الناس.
  // الآن: `carry` سالبٌ = **رصيدٌ لهم** يُحتسب في تفعيلهم القادم، وهو مفهومٌ قائمٌ في البيانات
  // أصلاً (حارسُ المال يُعدّه صنفاً طبيعيّاً: «مشتركون لهم رصيد (carry سالب)»).
  const currentCarry = subscriber.carry ?? 0;
  const newCarry = currentCarry - amount;
  const overpaid = newCarry < 0 ? -newCarry : 0; // الزائدُ الذي صار رصيداً — يُذكَر في القيد والتدقيق

  {
    const e = requireTower(subscriber.towerId, "تسديد الدين");
    if (e) return e;
  }
  // البند ٦ · يُعاد **رقمُ قيد الصندوق** كي تستطيع الواجهةُ طبعَ وصلِ هذا التسديد
  // بعينه (لا «آخرَ تسديدٍ للمشترك» — فمَن سدّد مرّتَين في يومٍ له وصلان مختلفان).
  const [, tx] = await prisma.$transaction([
    prisma.subscriber.update({
      where: { id: subscriberId },
      // 🔴 حرِجة ٣ · تسديدٌ ذرّيّ: كان `carry: newCarry` مطلقاً من قراءةٍ سابقة، فتفعيلٌ
      //   متزامنٌ يمحو هذا التسديد (القبضُ يبقى والدَّينُ يرجع). النقصانُ (amount) مستقلٌّ
      //   عن القديم ⇒ `decrement` ذرّيّ يبقى صحيحاً مهما تزامن. (newCarry تبقى للوصل والتدقيق.)
      data: { carry: { decrement: amount } },
    }),
    prisma.moneyTx.create({
      data: {
        moneyIn: amount,
        moneyOut: 0,
        // ب-٠٠ · يُذكَر الزائدُ في نصّ القيد نفسِه — فالمصروفاتُ والتقريرُ اليوميّ هما ما يراه
        // المدير، ولا يجوز أن يمرّ رصيدٌ لمشتركٍ بلا أثرٍ مقروء.
        notes: `تسديد دين${master ? " (ماستر)" : ""} - ${subscriber.name ?? subscriberId}`
          + (overpaid > 0 ? ` · زائدٌ ${overpaid} صار رصيداً للمشترك` : ""),
        date: new Date(),
        serverDate: new Date(),
        userId: session?.userId,
        // master ⇒ يُوجَّه لحساب الماستر (خارج الصندوق والتقارير) بدل النقد
        sourceType: master ? "master-debt" : "debt", sourceId: subscriberId, towerId: subscriber.towerId,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: session?.userId,
        action: "PAY_DEBT",
        entity: "subscriber",
        entityId: String(subscriberId),
        details: `تسديد${master ? " ماستر" : ""} ${amount} - المتبقّي ${newCarry}`
          + (overpaid > 0 ? ` (زائدٌ ${overpaid} صار رصيداً للمشترك)` : ""),
      },
    }),
  ]);

  // رسالة تأكيد التسديد للمشترك (قالب «تسديد دين») — لا يُفشل التسديدَ تعذُّرُ الإرسال
  await sendDebtPaidMessage({
    subscriberId, name: subscriber.name, netUser: subscriber.netUser,
    phone: subscriber.phone, waEnabled: subscriber.waEnabled,
    towerId: subscriber.towerId, amount, newCarry,
    code: subscriber.rewardCode, balance: subscriber.rewardBalance ?? 0,
    createdByUser: session?.username ?? null,
  }).catch(() => {});

  return NextResponse.json({ ok: true, newCarry, txId: tx.id });
}

// إرسال رسالة «تم تسديد دفعة من الديون» بقالب وكيل مكتب المشترك (أو النص الافتراضي)
async function sendDebtPaidMessage(a: {
  subscriberId: number; name: string | null; netUser: string | null;
  phone: string | null; waEnabled: boolean | null;
  towerId: number | null; amount: number; newCarry: number;
  code?: string | null; balance?: number;
  createdByUser?: string | null;
}): Promise<void> {
  try {
    if (!a.phone || a.waEnabled === false) return; // يحترم خيار واتساب لكل مشترك

    const office = a.towerId ? await prisma.tower.findUnique({ where: { id: a.towerId }, select: { name: true, waEnabled: true, agentId: true } }) : null;
    if (office?.waEnabled === "0") return;

    const tpl = await getEffectiveTemplateFull("debtPaid", office?.agentId ?? null, a.towerId);
    if (!tpl) return; // معطَّل

    // ب-٠٠ · `carry` سالبٌ = **رصيدٌ للمشترك** لا دَينٌ سالب. فالمخزَّنُ يبقى سالباً (وهو الحقُّ
    // المحاسبيّ)، وأمّا **الرسالةُ إليه** فلا يجوز أن تقول «إجمالي ديونك −١٠٠٠٠» — تُقصَر على صفر.
    const debtShown = Math.max(0, a.newCarry);
    const text = renderTemplate(tpl.text, {
      name: a.name,
      netUser: a.netUser,
      paid: a.amount, // {المبلغ_المستلم}
      carry: debtShown, // {اجمالي_الديون} بعد التسديد — لا يُعرَض سالباً للمشترك
      remaining: debtShown,
      code: a.code, balance: a.balance ?? 0, // كود/رصيد الخصم
      office: office?.name ?? "",
    });

    const res = await sendViaProvider("WHATSAPP", a.phone, text, a.towerId, tpl.image);
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", subscriberId: a.subscriberId, phone: a.phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
        createdByUser: a.createdByUser ?? null,
        agentId: office?.agentId ?? null, // عزل: سجلُّ الرسائل يُرشَّح بالوكيل — وبلاه تغيب الرسالة عن صاحبها
      },
    });
  } catch {
    // الرسالة ثانوية — لا تؤثر على نجاح التسديد
  }
}
