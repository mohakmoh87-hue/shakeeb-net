import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { appendCardHistory, getOrCreatePettyAccount, endSupport, resolveCardActor } from "@/lib/field";
import { renderTemplate, sendViaProvider } from "@/lib/messaging";
import { formatDate } from "@/lib/format";
import { redeemReward, sendRewardUsedMessage } from "@/lib/rewards";
import { baghdadDayKey } from "@/lib/attendance";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

// يحاول إيجاد مشترك من نصّ البطاقة (يوزر/هاتف) ضمن مكتب الفني.
async function matchSubscriber(text: string, towerId: number | null) {
  // 1) يوزر صريح بعد "اليوزر:"
  const userLine = text.match(/اليوزر\s*[:：]\s*([^\n]+)/);
  const explicit = userLine?.[1]?.trim();
  const where = towerId != null ? { towerId } : {};
  if (explicit && explicit !== "—") {
    const s = await prisma.subscriber.findFirst({
      where: { isDeleted: false, netUser: { equals: explicit, mode: "insensitive" }, ...where },
      select: { id: true, name: true, phone: true, netUser: true, towerId: true, rewardCode: true, rewardBalance: true },
    });
    if (s) return s;
  }
  // 2) مطابقة أي كلمة في النص مع netUser للمشتركين
  const words = [...new Set(text.split(/[\s،,\n]+/).map((w) => w.trim()).filter((w) => w.length >= 3))];
  if (words.length === 0) return null;
  return prisma.subscriber.findFirst({
    where: { isDeleted: false, netUser: { in: words, mode: "insensitive" }, ...where },
    select: { id: true, name: true, phone: true, netUser: true, towerId: true, rewardCode: true, rewardBalance: true },
  });
}

const schema = z.object({
  cardId: z.coerce.number().int().positive(),
  serviceDetails: z.string().nullish(), // يقبل نصاً/غياباً/null
  amount: z.coerce.number().min(0).optional(),
  newUser: z.string().nullish(), // اليوزر الجديد (إلزامي لبطاقة التحويل)
  photo: z.string().max(2_000_000, "حجم الصورة كبير جداً").nullish(), // data URL — null عند عدم رفع صورة (اختيارية للمدير/المستخدم)
  materials: z
    .array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number().positive() }))
    .optional()
    .default([]),
  useReward: z.boolean().optional().default(false), // سحب كود مكافأة المشترك خصماً من المبلغ
  noSale: z.boolean().optional().default(false), // «بلا مبيع»: لا مادة مباعة (المبلغ صفر) — خيار وليس مادة
});

// إنجاز بطاقة — بحقولها الواجبة حسب النوع:
//  • صيانة: تفاصيل + مبلغ + صورة (المواد اختيارية).
//  • توصيل: مبلغ فقط.
// منطق المواد: تُباع من المخزن (تُضاف للمبيعات)، وتُخصم من ذمّة الفني. والمبلغ يُقسَّم:
// جزء بقيمة المواد المباعة (مبيعات)، والباقي مقبوض في حساب "نثرية". وإن كان المبلغ
// أقل من قيمة المواد فكامله يُسجَّل للمبيعات فقط.
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { cardId, serviceDetails, amount, newUser, photo, materials, useReward, noSale } = parsed.data;

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة مسبقاً" }, { status: 400 });
  // الفاعل: مستخدم المكتب/المدير، أو الفني نفسه على بطاقته المسندة إليه (بعزل صارم)
  const auth = await resolveCardActor(cardId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const actor = auth.actor;
  if (card.technicianId == null) {
    return NextResponse.json({ error: "يجب توجيه البطاقة لفني قبل إنجازها" }, { status: 400 });
  }
  // نوع البطاقة (معزول بالوكيل): توصيل (مبلغ فقط) / تحويل (يوزر جديد إلزامي) / صيانة وغيرها (حقول كاملة)
  const type = await prisma.cardType.findFirst({ where: { name: card.kind, isDeleted: false, agentId: actor.agentId ?? -1 } });
  const isDelivery = type?.deliveryOnly ?? card.kind === "توصيل";
  const isTransfer = card.kind === "تحويل";

  // التوصيل مُستثنى من «بدء» واحتساب الوقت؛ ما عداه يتطلّب «بدء»
  if (!isDelivery && !card.startedAt) {
    return NextResponse.json({ error: "اضغط «بدء» قبل إنجاز البطاقة" }, { status: 400 });
  }
  // مدة الإنجاز = من وقت البدء حتى الآن (null للتوصيل بلا بدء)
  const durationSec = card.startedAt ? Math.max(0, Math.round((Date.now() - card.startedAt.getTime()) / 1000)) : null;

  // التحقّق من الحقول الواجبة — المبلغ قد يكون صفراً (بطاقات مجانية)، لكنه يجب أن يُحدَّد
  if (amount == null || amount < 0) {
    return NextResponse.json({ error: "المبلغ مطلوب (يمكن أن يكون صفراً)" }, { status: 400 });
  }
  // حد أدنى إلزامي: أي مبلغ مُدخَل لا يقل عن 1000 دينار (الصفر مسموح مع «بلا مبيع»/المجاني)
  if (amount > 0 && amount < 1000) {
    return NextResponse.json({ error: "المبلغ لا يقل عن 1000 دينار (أو صفر للمجاني)" }, { status: 400 });
  }
  if (isTransfer) {
    if (!newUser?.trim()) return NextResponse.json({ error: "اليوزر الجديد مطلوب لإنجاز التحويل" }, { status: 400 });
  } else if (!isDelivery) {
    if (!serviceDetails?.trim()) return NextResponse.json({ error: "تفاصيل الصيانة مطلوبة" }, { status: 400 });
    // الصورة إلزامية على الفني فقط؛ اختيارية للمدير والمستخدم
    if (actor.isTech && !photo?.trim()) return NextResponse.json({ error: "رفع صورة مطلوب" }, { status: 400 });
    // إلزامي: اختيار مادة من ذمّة الفني أو «بلا مبيع» صراحةً (بلا مبيع ⇒ المبلغ صفر)
    if (materials.length === 0 && !noSale) {
      return NextResponse.json({ error: "اختر مادة من الذمّة أو «بلا مبيع» (إلزامي)" }, { status: 400 });
    }
    if (noSale && materials.length === 0 && amount > 0) {
      return NextResponse.json({ error: "مع «بلا مبيع» يبقى المبلغ صفراً — أو اختر المادة المباعة" }, { status: 400 });
    }
  }

  const tech = await prisma.technician.findUnique({ where: { id: card.technicianId } });
  // مكتب البطاقة (حيث تمّ العمل) — لعزل المبيعات/النثرية؛ يهمّ عند الدعم المؤقّت من مكتب آخر
  const list = await prisma.taskList.findUnique({ where: { id: card.listId }, select: { boardId: true, timeTracked: true } });
  const board = list ? await prisma.taskBoard.findUnique({ where: { id: list.boardId }, select: { towerId: true } }) : null;
  const towerId = board?.towerId ?? tech?.towerId ?? null;

  // ===== معالجة المواد (للصيانة فقط؛ التوصيل بلا مواد) =====
  const soldInfo: { itemId: number; name: string; qty: number; price: number }[] = [];
  let materialsTotal = 0;
  if (!isDelivery && materials.length > 0) {
    for (const m of materials) {
      const item = await prisma.item.findFirst({ where: { id: m.itemId, isDeleted: false } });
      if (!item) return NextResponse.json({ error: `مادة #${m.itemId} غير موجودة` }, { status: 404 });
      const custody = await prisma.custody.findFirst({
        where: { technicianId: card.technicianId, itemId: m.itemId, isDeleted: false },
      });
      if (!custody || custody.qty < m.qty) {
        return NextResponse.json({ error: `الكمية بذمّة الفني من «${item.name}» غير كافية` }, { status: 400 });
      }
      const price = item.priceSale ?? 0;
      materialsTotal += price * m.qty;
      soldInfo.push({ itemId: item.id, name: item.name ?? "مادة", qty: m.qty, price });
    }
  }

  // سحب كود المكافأة (اختياري): نحلّ مشترك البطاقة ونتحقّق من تفعيل النظام لهذا المكتب.
  // التوصيل مستثنى: مكافأته تُطبَّق عند تفعيل الاشتراك (المصدر المالي الوحيد للتوصيل).
  let rewardSubId: number | null = null;
  if (useReward && !isTransfer && !isDelivery && towerId) {
    const off = await prisma.tower.findUnique({ where: { id: towerId }, select: { rewardsEnabled: true } });
    if (off?.rewardsEnabled === "1") {
      const s = await matchSubscriber(`${card.title}\n${card.description ?? ""}`, towerId);
      rewardSubId = s?.id ?? null;
    }
  }

  // حساب النثرية إن لزم (قد لا يُستخدم إن غطّت المكافأة كامل المبلغ).
  // ⚠️ التوصيل مستثنى كلياً من الحسابات: مبلغه يُسجَّل مالياً مرة واحدة فقط عند تفعيل
  // الاشتراك من المستخدم — الإنجاز يخزّنه على البطاقة كرقم قراءة فقط بذمّة الفني
  // (ليُعرف كم يسدّد للمستخدم) بلا أي قيد في الصندوق أو التقارير (يمنع الازدواج).
  const petty = !isDelivery && amount > 0 ? await getOrCreatePettyAccount(towerId) : null;

  let salesShare = 0, pettyShare = 0, rewardDiscount = 0;
  await prisma.$transaction(async (tx) => {
    // خصم كود المكافأة أولاً (بحدّ المبلغ، ويبقى الباقي للمشترك)
    if (rewardSubId) {
      const r = await redeemReward(tx, {
        subscriberId: rewardSubId, billAmount: amount, context: "maintenance", refId: cardId,
        towerId, agentId: actor.agentId ?? null, createdByUser: String(actor.userId ?? ""), createdByName: actor.name ?? undefined,
      });
      rewardDiscount = r?.discount ?? 0;
    }
    // المبلغ الصافي بعد الخصم = المُحصَّل فعلياً من المشترك
    const netAmount = Math.max(0, amount - rewardDiscount);
    salesShare = materials.length > 0 ? Math.min(netAmount, materialsTotal) : 0;
    pettyShare = netAmount - salesShare;

    // خصم المواد من المخزن ومن ذمّة الفني
    for (const s of soldInfo) {
      const item = await tx.item.findUnique({ where: { id: s.itemId } });
      await tx.item.update({ where: { id: s.itemId }, data: { count: (item?.count ?? 0) - s.qty } });
      // فنيٌّ مُعار «دعماً» يبيع من ذمّته في مكتب آخر: تُرحَّل المادة لمكتب البطاقة ثم
      // تُباع منه فوراً — المصدر نقص أعلاه، ومادة الوجهة تُنشأ إن غابت (صافي مخزونها
      // صفر: ترحيل + بيع فوري)، وقيد المبيعات يُسجَّل لمكتب البطاقة أدناه أصلاً.
      // فيتصرّف الفني كأنه تابع للمكتب الطالب للدعم من كل النواحي.
      if (item?.towerId != null && towerId != null && item.towerId !== towerId) {
        const destItem = await tx.item.findFirst({ where: { name: item.name, towerId, isDeleted: false } });
        if (!destItem) {
          await tx.item.create({
            data: {
              name: item.name, category: item.category, priceDinar: item.priceDinar,
              priceSale: item.priceSale, priceSale2: item.priceSale2, barcode: item.barcode,
              count: 0, towerId,
            },
          });
        }
      }
      const custody = await tx.custody.findFirst({
        where: { technicianId: card.technicianId!, itemId: s.itemId, isDeleted: false },
      });
      if (custody) await tx.custody.update({ where: { id: custody.id }, data: { qty: custody.qty - s.qty } });
    }
    // قيد المبيعات (حصّة المواد)
    if (salesShare > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: salesShare, moneyOut: 0, date: new Date(), serverDate: new Date(),
          userId: actor.userId, sourceType: "sale", sourceId: cardId, towerId,
          notes: `مبيع ذمم — تكت #${cardId}: ` + soldInfo.map((s) => `${s.name}×${s.qty}`).join("، "),
        },
      });
    }
    // قيد النثرية (الباقي)
    if (petty && pettyShare > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: pettyShare, moneyOut: 0, date: new Date(), serverDate: new Date(),
          userId: actor.userId, accountId: petty.id, sourceType: "manual", towerId,
          notes: `نثرية — ${isDelivery ? "توصيل" : "صيانة"} تكت #${cardId}` + (rewardDiscount > 0 ? ` (مكافأة −${rewardDiscount})` : ""),
        },
      });
    }
    // حفظ الصورة (تُحذف مع البطاقة/التحصيل)
    if (photo?.trim()) {
      await tx.cardPhoto.upsert({
        where: { cardId }, update: { data: photo }, create: { cardId, data: photo },
      });
    }
    // إنجاز البطاقة — المبلغ المخزَّن = الصافي بعد خصم المكافأة (المُحصَّل فعلاً)
    await tx.taskCard.update({
      where: { id: cardId },
      data: {
        done: true, completedAt: new Date(), durationSec,
        amount: netAmount,
        serviceDetails: (serviceDetails?.trim() || null) ? `${serviceDetails!.trim()}${rewardDiscount > 0 ? `\n(خصم مكافأة: ${rewardDiscount} د.ع)` : ""}` : (rewardDiscount > 0 ? `(خصم مكافأة: ${rewardDiscount} د.ع)` : null),
        materialsInfo: soldInfo.length ? JSON.stringify(soldInfo) : null,
      },
    });
  });

  // سجل التغييرات داخل البطاقة: من أنجزها وبأي مبلغ (الصافي المُحصَّل)
  const paidNet = Math.max(0, amount - rewardDiscount);
  await appendCardHistory(cardId, actor.name, `إنجاز البطاقة — المبلغ ${paidNet.toLocaleString("en-US")} د.ع`);

  // إشعار إنجاز البطاقة (جرس + Push للهاتف/المتصفح حتى والبرنامج مغلق) — لا يضيع أي إنجاز
  await notify({
    agentId: actor.agentId ?? null, towerId, type: "cardDone",
    title: `✅ أُنجزت بطاقة «${card.kind ?? "مهمة"}»`,
    body: `${card.title}${actor.name ? ` — بواسطة ${actor.name}` : ""}${paidNet > 0 ? ` — المبلغ ${paidNet.toLocaleString("en-US")} د.ع` : ""}`,
    refType: "card", refId: cardId,
  });

  // ===== خصم معلّق عند تجاوز الوقت (عمود «محسوب بالوقت» + نوع له وقت مسموح + غير توصيل) =====
  let overrunResult: { amount: number; overrunMin: number } | null = null;
  if (!isDelivery && list?.timeTracked && durationSec != null && (type?.execMinutes ?? 0) > 0 && (type?.overrunDeduction ?? 0) > 0) {
    const overSec = durationSec - type!.execMinutes! * 60;
    if (overSec > 0) {
      const overrunMin = Math.ceil(overSec / 60);
      const amount = overrunMin * type!.overrunDeduction!;
      if (amount > 0) {
        await prisma.adjustment.create({
          data: {
            technicianId: card.technicianId, agentId: actor.agentId ?? null, towerId,
            kind: "deduction", source: "overrun", amount, overrunMin,
            reason: `تجاوز وقت «${card.kind}» ${overrunMin} دقيقة (تكت #${cardId})`,
            cardId, status: "pending", dayKey: baghdadDayKey(new Date()),
          },
        }).catch(() => {}); // لا يُفشل الإنجاز إن تعذّر إنشاء الخصم
        await notify({ agentId: actor.agentId ?? null, towerId, type: "deduction", title: "خصم تجاوز وقت معلّق", body: `${tech?.name ?? "فني"}: تجاوز «${card.kind}» ${overrunMin} دقيقة — خصم ${amount.toLocaleString("en-US")}`, refType: "adjustment", url: "/field-management?open=deductions" });
        overrunResult = { amount, overrunMin };
      }
    }
  }

  // ===== دعم ببطاقات محدّدة: إن أُكملت كل بطاقات الدعم ⇒ عودة تلقائية للفني لمكتبه =====
  if (tech?.supportTowerId != null && tech.supportKind === "cards" && tech.supportCardIds) {
    try {
      const ids = JSON.parse(tech.supportCardIds) as number[];
      if (Array.isArray(ids) && ids.includes(cardId)) {
        const remaining = await prisma.taskCard.count({ where: { id: { in: ids }, done: false, isDeleted: false } });
        if (remaining === 0) {
          await endSupport(tech.id);
          await notify({ agentId: actor.agentId ?? null, towerId: tech.towerId, type: "checkout", title: "انتهاء الدعم", body: `${tech.name} أكمل بطاقات الدعم وعاد لمكتبه`, refType: "technician", refId: tech.id });
        }
      }
    } catch { /* تجاهل إن كان supportCardIds غير صالح */ }
  }

  // رسالة تأكيد استخدام المكافأة (بعد الإنجاز، أفضل جهد)
  if (rewardSubId && rewardDiscount > 0) {
    const rs = await prisma.subscriber.findUnique({ where: { id: rewardSubId }, select: { phone: true, waEnabled: true, name: true, rewardBalance: true } });
    if (rs) void sendRewardUsedMessage({
      subscriberId: rewardSubId, officeId: towerId, agentId: actor.agentId ?? null,
      phone: rs.phone, waEnabled: rs.waEnabled, name: rs.name, discount: rewardDiscount, balance: rs.rewardBalance ?? 0, createdByUser: String(actor.userId ?? ""),
    });
  }

  // سجل تدقيق: من أنجز أي بطاقة ولأي مكتب (مساءلة، خاصة عند الدعم بين المكاتب)
  await prisma.auditLog.create({
    data: {
      userId: actor.userId, action: "COMPLETE_CARD", entity: "taskCard", entityId: String(cardId),
      details: `إنجاز بطاقة «${card.title}» (${card.kind}) — فني ${tech?.name ?? card.technicianId} — مكتب ${towerId ?? "?"} — مبلغ ${amount} — بواسطة ${actor.isTech ? "الفني نفسه" : (actor.name || "المكتب")}`,
    },
  }).catch(() => {});

  // ===== ما بعد الإنجاز (لا يُفشل الإنجاز إن تعثّر): مطابقة المشترك، سجل الصيانات، رسالة واتساب =====
  let matchedSubscriber: number | null = null;
  let messaged = false;
  try {
    const cardText = `${card.title}\n${card.description ?? ""}`;
    const sub = await matchSubscriber(cardText, towerId);
    if (sub) {
      matchedSubscriber = sub.id;
      // تحويل: تحديث يوزر المشترك لليوزر الجديد + تسجيله بسجل الصيانات
      if (isTransfer && newUser?.trim()) {
        const nu = newUser.trim();
        // تحديث اليوزر + وسم التحويل (يُنبَّه عند التفعيل ويُحذف بعد 30 يوماً دون تفعيل)
        await prisma.subscriber.update({ where: { id: sub.id }, data: { netUser: nu, transferredAt: new Date(), transferredTo: nu } });
        await prisma.maintenanceLog.create({
          data: {
            subscriberId: sub.id,
            details: `تحويل اليوزر من «${sub.netUser ?? "—"}» إلى «${nu}»`,
            technicianName: tech?.name ?? null, cardTitle: card.title, kind: card.kind, durationSec, amount: paidNet, date: new Date(),
          },
        });
      }
      // سجل صيانات المشترك (بلا صور) — للصيانة/التنصيب التي لها تفاصيل
      if (!isDelivery && !isTransfer && serviceDetails?.trim()) {
        await prisma.maintenanceLog.create({
          data: {
            subscriberId: sub.id,
            details: serviceDetails.trim(),
            technicianName: tech?.name ?? null,
            cardTitle: card.title,
            kind: card.kind,
            durationSec,
            amount: paidNet,
            date: new Date(),
          },
        });
      }
      // رسالة واتساب للمشترك (قالب "رسالة الصيانة/التنصيب") — قالب وكيل الفاعل حصراً (عزل)
      const tpl = await prisma.smsTemplate.findFirst({ where: { type: "maintenance", agentId: actor.agentId ?? -1 } });
      if (sub.phone && tpl?.text && tpl.enable !== "0") {
        const office = towerId ? await prisma.tower.findUnique({ where: { id: towerId }, select: { name: true, waEnabled: true } }) : null;
        if (office?.waEnabled !== "0") {
          const text = renderTemplate(tpl.text, {
            name: sub.name, netUser: sub.netUser, kind: card.kind,
            details: serviceDetails?.trim() ?? "", amount, date: formatDate(new Date()),
            technician: tech?.name ?? "", office: office?.name ?? "SHAKEEB",
            code: sub.rewardCode, balance: sub.rewardBalance ?? 0, // كود/رصيد الخصم
          });
          let res: { ok: boolean; error?: string };
          try { res = await sendViaProvider("WHATSAPP", sub.phone, text, towerId); }
          catch (e) { res = { ok: false, error: e instanceof Error ? e.message : "تعذّر الإرسال" }; }
          messaged = res.ok;
          await prisma.message.create({
            data: {
              channel: "WHATSAPP", subscriberId: sub.id, phone: sub.phone, text,
              status: res.ok ? "SENT" : "FAILED", error: res.error ?? null,
              createdByUser: String(actor.userId ?? ""),
            },
          });
        }
      }
    }
  } catch {
    // تجاهل: الإنجاز تمّ بنجاح بغضّ النظر عن الرسالة/السجل
  }

  return NextResponse.json({ ok: true, salesShare, pettyShare, rewardDiscount, hasPhoto: !!photo, matchedSubscriber, messaged, overrun: overrunResult });
}
