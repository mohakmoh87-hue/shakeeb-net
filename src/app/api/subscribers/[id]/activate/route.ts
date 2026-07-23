import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { computeDateTo } from "@/lib/subscription";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { formatDate } from "@/lib/format";
import { sasBaseUrl, sasLogin, sasFetchUser } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";
import { grantReward, sendRewardGrantMessage } from "@/lib/rewards";
import { getEffectiveTemplate } from "@/lib/smsTemplates";

const schema = z.object({
  packageId: z.coerce.number(),
  cardId: z.coerce.number().nullable().optional(),
  paid: z.coerce.number().min(0).default(0), // المبلغ الواصل (الباقي دين)
  months: z.coerce.number().min(1).default(1),
  totalOverride: z.coerce.number().min(0).nullable().optional(), // تعديل يدوي لمبلغ التفعيل
  delivery: z.coerce.number().min(0).default(0), // مبلغ التوصيل (يُضاف على مبلغ الاشتراك)
  dateToOverride: z.string().nullable().optional(), // تعديل يدوي لتاريخ الانتهاء (ISO)
  master: z.boolean().default(false), // تفعيل ماستر: واصل كامل بلا دين، ويُسجَّل بحساب الماستر المستقل
  note: z.string().nullable().optional(), // ملاحظة الوصل → notes
  dueDate: z.string().nullable().optional(), // موعد التسديد → nextDate
  paymentMethod: z.string().nullable().optional(), // طريقة الدفع → operation
});

// تفعيل مشترك: استهلاك الكارت + تسجيل الاشتراك + الواصل/الدين + تمديد الانتهاء
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("subscriptions.manage");
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
  const { packageId, cardId, paid, months, totalOverride, delivery, dateToOverride, master, note, dueDate, paymentMethod } = parsed.data;
  // موعد التسديد (اختياري) — يُخزَّن في nextDate
  const dueDateParsed = dueDate ? new Date(dueDate) : null;
  const nextDate = dueDateParsed && !isNaN(dueDateParsed.getTime()) ? dueDateParsed : null;

  const subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
  if (!subscriber || subscriber.isDeleted || !(await ownsTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }
  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
  if (!pkg || pkg.isDeleted) {
    return NextResponse.json({ error: "الفئة غير موجودة" }, { status: 404 });
  }

  // سيريال الكارت (للعرض في الوصل)
  let cardSerial: string | null = null;
  if (cardId) {
    const c = await prisma.rechargeCard.findUnique({ where: { id: cardId }, select: { serial: true } });
    cardSerial = c?.serial ?? null;
  }

  const price = pkg.priceDinar ?? 0;
  const now = new Date();
  const start = subscriber.dateTo && subscriber.dateTo > now ? subscriber.dateTo : now;

  // بيانات المكتب (نظام التفعيل + بيانات دخول SAS4)
  const tower = subscriber.towerId
    ? await prisma.tower.findUnique({
        where: { id: subscriber.towerId },
        select: { activationMode: true, loginUrl: true, username: true, password: true, rewardsEnabled: true },
      })
    : null;

  // نظام المكافآت: يُمنح كود عند التفعيل إن كان مفعّلاً للمكتب وللباقة مبلغ مكافأة.
  // انقطاع التجديد (اشتراك منتهٍ قبل هذا التفعيل) يُصفّر الرصيد المتراكم قبل المنح الجديد.
  const rewardsOn = tower?.rewardsEnabled === "1" && (pkg.rewardAmount ?? 0) > 0;
  const hadGap = !subscriber.dateTo || subscriber.dateTo <= now;

  // تاريخ الانتهاء:
  // 1) عند سحب كارت: نقرأ تاريخ الانتهاء الفعلي من SAS4 لحظة التأكيد (يراعي قرض اليوم الواحد)
  // 2) بدون كارت: التاريخ اليدوي إن حُدّد، وإلا الحساب الطبيعي حسب نظام المكتب
  let dateTo: Date | null = null;

  if (cardId && subscriber.sasId && tower?.loginUrl && tower.username && tower.password && !(await sasHostBlocked(tower.loginUrl))) {
    try {
      const base = sasBaseUrl(tower.loginUrl);
      const token = await sasLogin(base, tower.username, tower.password);
      const info = await sasFetchUser(base, token, subscriber.sasId);
      if (info?.expiration) {
        const d = new Date(info.expiration);
        if (!isNaN(d.getTime())) dateTo = d;
      }
    } catch {
      /* تعذّر قراءة SAS — نرجع للحساب الطبيعي أدناه */
    }
  }

  if (!dateTo) {
    if (dateToOverride) {
      const d = new Date(dateToOverride);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "تاريخ الانتهاء غير صحيح" }, { status: 400 });
      }
      dateTo = d;
    } else {
      dateTo = computeDateTo(start, months, tower?.activationMode);
    }
  }

  // مبلغ التفعيل (الاشتراك): يدوي إن حُدّد، وإلا سعر الباقة × عدد الأشهر
  const total = totalOverride != null ? totalOverride : price * months;
  // الإجمالي المستحق = الاشتراك + التوصيل؛ الواصل يُخصم منه والباقي دين
  const grandTotal = total + delivery;
  // ماستر: واصل كامل بلا دين جديد (يبقى دين المشترك السابق كما هو)
  const effPaid = master ? grandTotal : paid;
  const newCarry = master ? (subscriber.carry ?? 0) : (subscriber.carry ?? 0) + grandTotal - paid;

  let rewardGrant: { code: string; balance: number; granted: number } | null = null;
  // كود/رصيد الخصم للرسالة — يُلتقط داخل المعاملة (الكود الجديد الممنوح إن وُجد، وإلا الحالي)
  let msgRewardCode: string | null = subscriber.rewardCode ?? null;
  let msgRewardBalance = subscriber.rewardBalance ?? 0;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // استهلاك الكارت ذرّياً عند التأكيد فقط (يمنع تعارض مكتبين)
      if (cardId) {
        const claim = await tx.rechargeCard.updateMany({
          where: { id: cardId, useDate: null, agentId: session?.agentId ?? -1 }, // عزل: كارت وكيل المستخدم فقط
          data: { useDate: now, subscriberId, userName: session?.fullName, reservedBy: null, reservedAt: null },
        });
        if (claim.count === 0) throw new Error("CARD_TAKEN");
      }
      await tx.subscriber.update({
        where: { id: subscriberId },
        // التفعيل يمسح وسم التحويل (فلا يُنبَّه ولا يُحذف)
        data: { packageId, dateTo, carry: newCarry, wasel: effPaid, month: months, transferredAt: null, transferredTo: null },
      });
      const entry = await tx.subscriptionEntry.create({
        data: {
          subscriberId, date: now, dateFrom: start, dateTo, money: total, moneyIn: effPaid,
          addPrice: delivery, // مبلغ التوصيل (للوصل والتقارير)
          moneyCarry: newCarry, moneyType: 1, month: String(months), cardType: pkg.name,
          card2: cardSerial, towerId: subscriber.towerId, createdByUser: session?.username,
          isMaster: master,
          notes: note ?? null, // ملاحظة الوصل
          nextDate, // موعد التسديد
          operation: paymentMethod ?? null, // طريقة الدفع
        },
      });
      // منح مكافأة التفعيل (كود + رصيد متراكم) — يشمل العادي والماستر، مربوطة بهذا الوصل
      if (rewardsOn) {
        rewardGrant = await grantReward(tx, {
          subscriberId, towerId: subscriber.towerId, agentId: session?.agentId ?? null,
          subscriberName: subscriber.name, currentBalance: subscriber.rewardBalance ?? 0,
          hadGap, rewardAmount: pkg.rewardAmount ?? 0, months, refId: entry.id,
          createdByUser: session?.username, createdByName: session?.fullName,
        });
        if (rewardGrant) { msgRewardCode = rewardGrant.code; msgRewardBalance = rewardGrant.balance; }
      }
      if (effPaid > 0) {
        await tx.moneyTx.create({
          data: {
            moneyIn: effPaid, moneyOut: 0,
            notes: `${master ? "ماستر " : "تفعيل "}${pkg.name} - ${subscriber.name ?? subscriberId}${delivery > 0 ? ` (توصيل ${delivery})` : ""}`,
            date: now, serverDate: now, userId: session?.userId,
            // ماستر: حساب مستقل (sourceType=master) لا يُجمع مع التقرير اليومي
            sourceType: master ? "master" : "activation", sourceId: entry.id, towerId: subscriber.towerId,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: session?.userId, action: "ACTIVATE", entity: "subscriber", entityId: String(subscriberId),
          details: `تفعيل ${pkg.name} - كارت ${cardSerial ?? "بدون"} - اشتراك ${total}${delivery > 0 ? ` - توصيل ${delivery}` : ""} - واصل ${paid} - دين ${newCarry}`,
        },
      });
      return { ok: true, serial: cardSerial, dateTo, newCarry, entryId: entry.id };
    });

    // إرسال رسالة تفعيل صامتة للمشترك عبر واتساب (لا تُعطّل التفعيل لو فشلت)
    void sendActivationMessage({
      subscriberId,
      officeId: subscriber.towerId,
      phone: subscriber.phone,
      waEnabled: subscriber.waEnabled,
      name: subscriber.name,
      netUser: subscriber.netUser,
      packageName: pkg.name,
      card: cardSerial,
      price: total,
      delivery,
      paid,
      remaining: Math.max(0, total + delivery - paid),
      carry: newCarry,
      dateTo,
      code: msgRewardCode, balance: msgRewardBalance, // كود/رصيد الخصم بعد هذا التفعيل
      createdByUser: session?.username,
    });

    // رسالة مكافأة منفصلة (الكود + الرصيد) — عند منحها
    if (rewardGrant) {
      const rg: { code: string; balance: number; granted: number } = rewardGrant;
      void sendRewardGrantMessage({
        subscriberId, officeId: subscriber.towerId, agentId: session?.agentId ?? null,
        phone: subscriber.phone, waEnabled: subscriber.waEnabled, name: subscriber.name, netUser: subscriber.netUser,
        code: rg.code, balance: rg.balance, granted: rg.granted, createdByUser: session?.username,
      });
    }

    return NextResponse.json({ ...result, reward: rewardGrant });
  } catch (e) {
    if ((e as Error).message === "CARD_TAKEN") {
      return NextResponse.json({ error: "الكارت استُخدم للتو من مكتب آخر — اسحب كارتاً جديداً" }, { status: 409 });
    }
    throw e;
  }
}

// إرسال رسالة تفعيل صامتة عبر واتساب بقالب "التفعيل" (تُسجَّل في سجل الرسائل)
async function sendActivationMessage(a: {
  subscriberId: number;
  officeId: number | null;
  phone: string | null;
  waEnabled: boolean | null;
  name: string | null;
  netUser: string | null;
  packageName: string | null;
  card: string | null;
  price: number;
  delivery: number;
  paid: number;
  remaining: number;
  carry: number;
  dateTo: Date;
  code?: string | null;
  balance?: number;
  createdByUser?: string;
}): Promise<void> {
  try {
    if (a.waEnabled === false || !a.phone) return; // يحترم خيار واتساب لكل مشترك

    // مكتب المشترك: اسمه + تفعيل واتساب المكتب + وكيله (لجلب قالب وكيله حصراً)
    const office = a.officeId ? await prisma.tower.findUnique({ where: { id: a.officeId }, select: { name: true, waEnabled: true, agentId: true } }) : null;
    if (office?.waEnabled === "0") return;

    // قالب تفعيل وكيل مكتب المشترك (عزل — كان يُجلب بلا تحديد وكيل) مع النص الافتراضي عند غيابه
    const tplText = await getEffectiveTemplate("activation", office?.agentId ?? null, a.officeId);
    if (!tplText) return; // معطَّل أو لا قالب

    const text = renderTemplate(tplText, {
      name: a.name,
      netUser: a.netUser,
      package: a.packageName,
      card: a.card,
      price: a.price,
      delivery: a.delivery,
      // سطر التوصيل يظهر فقط عند وجود مبلغ توصيل (للاستخدام في القالب عبر {deliveryLine})
      deliveryLine: a.delivery > 0 ? `التوصيل: ${a.delivery} د.ع` : "",
      total: a.price + a.delivery,
      paid: a.paid,
      remaining: a.remaining,
      carry: a.carry,
      dateTo: formatDate(a.dateTo),
      code: a.code, balance: a.balance ?? 0, // كود/رصيد الخصم (فارغ لمن لا رصيد له)
      office: office?.name ?? "SHAKEEB",
    });

    const res = await sendViaProvider("WHATSAPP", a.phone, text, a.officeId); // واتساب مكتب المشترك
    await prisma.message.create({
      data: {
        channel: "WHATSAPP", subscriberId: a.subscriberId, phone: a.phone, text,
        status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
        createdByUser: a.createdByUser,
      },
    });
  } catch {
    // لا نُفشل التفعيل بسبب رسالة
  }
}
