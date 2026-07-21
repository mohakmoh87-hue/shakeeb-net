import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { getEffectiveTemplate } from "@/lib/smsTemplates";

const schema = z.object({
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
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
  const { amount } = parsed.data;

  const subscriber = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
  });
  if (!subscriber || subscriber.isDeleted || !(await ownsTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  const currentCarry = subscriber.carry ?? 0;
  const newCarry = Math.max(0, currentCarry - amount);

  await prisma.$transaction([
    prisma.subscriber.update({
      where: { id: subscriberId },
      data: { carry: newCarry },
    }),
    prisma.moneyTx.create({
      data: {
        moneyIn: amount,
        moneyOut: 0,
        notes: `تسديد دين - ${subscriber.name ?? subscriberId}`,
        date: new Date(),
        serverDate: new Date(),
        userId: session?.userId,
        sourceType: "debt", sourceId: subscriberId, towerId: subscriber.towerId,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: session?.userId,
        action: "PAY_DEBT",
        entity: "subscriber",
        entityId: String(subscriberId),
        details: `تسديد ${amount} - المتبقّي ${newCarry}`,
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

  return NextResponse.json({ ok: true, newCarry });
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

    const tpl = await getEffectiveTemplate("debtPaid", office?.agentId ?? null);
    if (!tpl) return; // معطَّل

    const text = renderTemplate(tpl, {
      name: a.name,
      netUser: a.netUser,
      paid: a.amount, // {المبلغ_المستلم}
      carry: a.newCarry, // {اجمالي_الديون} بعد التسديد
      remaining: a.newCarry,
      code: a.code, balance: a.balance ?? 0, // كود/رصيد الخصم
      office: office?.name ?? "",
    });

    const res = await sendViaProvider("WHATSAPP", a.phone, text, a.towerId);
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", subscriberId: a.subscriberId, phone: a.phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
        createdByUser: a.createdByUser ?? null,
      },
    });
  } catch {
    // الرسالة ثانوية — لا تؤثر على نجاح التسديد
  }
}
