import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { appendCardHistory, endSupport, resolveCardActor } from "@/lib/field";
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
  amount: z.coerce.number().min(0).optional(), // «التوصيل» فقط: مبلغه المعلوماتي (كما هو)
  sale: z.coerce.number().min(0).optional(), // «المبيع»: مبلغ بيع المواد (قابل للتعديل، يوزَّع نسبياً على الفاتورة)
  subscription: z.coerce.number().min(0).nullish(), // «اشتراك»: إلزامي تمريره (0 جائز) — معلوماتي بلا أثر مالي
  newUser: z.string().nullish(), // اليوزر الجديد (إلزامي لبطاقة التحويل)
  photo: z.string().max(2_000_000, "حجم الصورة كبير جداً").nullish(), // data URL — null عند عدم رفع صورة (اختيارية للمدير/المستخدم)
  materials: z
    .array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number().positive() }))
    .optional()
    .default([]),
  useReward: z.boolean().optional().default(false), // سحب كود مكافأة المشترك — يخصم من «المبيع» حصراً
  noSale: z.boolean().optional().default(false), // «بلا مبيع»: لا مادة مباعة (المبيع صفر) — خيار وليس مادة
});

// إنجاز بطاقة — بحقولها الواجبة حسب النوع:
//  • توصيل: مبلغ معلوماتي فقط (بلا أثر مالي — يُسجَّل عند التفعيل).
//  • صيانة/تنصيب/اعادة: تفاصيل + صورة (للفني) + مادة/«بلا مبيع» + «المبيع» + «اشتراك».
//  • تحويل: يوزر جديد (شرطه القديم) + شروط الصيانة الجديدة (مادة/مبيع/اشتراك).
// المحرك المالي: «المبيع» يُسجَّل حصراً كفاتورة مبيع (نوع «بيع صيانة») بأسعار موزّعة
// نسبياً على سطور المواد (نقصاً وزيادة) + قيد قبض الفاتورة — لا مبيعات/نثرية بعد اليوم.
// «اشتراك» رقم معلوماتي بذمة الفني (نمط التوصيل) يُسجَّل مالياً عند تفعيل الاشتراك فقط.
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { cardId, serviceDetails, amount, sale, subscription, newUser, photo, materials: rawMaterials, useReward, noSale } = parsed.data;
  // دمج تكرار نفس المادة في أكثر من قائمة منسدلة (تُجمع الكميات)
  const merged = new Map<number, number>();
  for (const m of rawMaterials) merged.set(m.itemId, (merged.get(m.itemId) ?? 0) + m.qty);
  const materials = [...merged.entries()].map(([itemId, qty]) => ({ itemId, qty }));

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

  // ===== التحقّق حسب النوع =====
  // التوصيل (كما هو): مبلغ معلوماتي إلزامي، صفر جائز، وما فوق الصفر لا يقل عن 1000
  if (isDelivery) {
    if (amount == null || amount < 0) {
      return NextResponse.json({ error: "المبلغ مطلوب (يمكن أن يكون صفراً)" }, { status: 400 });
    }
    if (amount > 0 && amount < 1000) {
      return NextResponse.json({ error: "المبلغ لا يقل عن 1000 دينار (أو صفر للمجاني)" }, { status: 400 });
    }
  } else {
    // الحقول الكاملة والتحويل (التحويل بشروطه القديمة + الجديدة):
    if (isTransfer && !newUser?.trim()) {
      return NextResponse.json({ error: "اليوزر الجديد مطلوب لإنجاز التحويل" }, { status: 400 });
    }
    if (!isTransfer) {
      if (!serviceDetails?.trim()) return NextResponse.json({ error: "تفاصيل الصيانة مطلوبة" }, { status: 400 });
      // الصورة إلزامية على الفني فقط؛ اختيارية للمدير والمستخدم
      if (actor.isTech && !photo?.trim()) return NextResponse.json({ error: "رفع صورة مطلوب" }, { status: 400 });
    }
    // القائمة الأولى إلزامية: مادة من ذمّته أو «بلا مبيع» صراحةً — ولا مواد مع «بلا مبيع»
    if (materials.length === 0 && !noSale) {
      return NextResponse.json({ error: "اختر مادة من الذمّة أو «بلا مبيع» (إلزامي)" }, { status: 400 });
    }
    if (noSale && materials.length > 0) {
      return NextResponse.json({ error: "«بلا مبيع» لا تُختار معها مواد" }, { status: 400 });
    }
    // «المبيع»: مطلوب (0 جائز)؛ مع «بلا مبيع» يكون صفراً حتماً؛ وما فوق الصفر ≥ 1000
    if (sale == null) return NextResponse.json({ error: "مبلغ «المبيع» مطلوب (يمكن أن يكون صفراً)" }, { status: 400 });
    if (noSale && sale > 0) return NextResponse.json({ error: "مع «بلا مبيع» يبقى المبيع صفراً" }, { status: 400 });
    if (sale > 0 && sale < 1000) return NextResponse.json({ error: "مبلغ المبيع لا يقل عن 1000 دينار (أو صفر)" }, { status: 400 });
    // «اشتراك»: إلزامي إدخاله صراحةً (0 جائز)، وما فوق الصفر ≥ 1000
    if (subscription == null) return NextResponse.json({ error: "مبلغ «اشتراك» مطلوب — أدخِل 0 إن لم يُستلم اشتراك" }, { status: 400 });
    if (subscription > 0 && subscription < 1000) return NextResponse.json({ error: "مبلغ الاشتراك لا يقل عن 1000 دينار (أو صفر)" }, { status: 400 });
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

  // مطابقة مشترك البطاقة مرة واحدة (تُستخدم للفاتورة والمكافأة وسجل الصيانة والرسالة)
  let matchedSub: Awaited<ReturnType<typeof matchSubscriber>> = null;
  try { matchedSub = await matchSubscriber(`${card.title}\n${card.description ?? ""}`, towerId); } catch { matchedSub = null; }

  // «المبيع» و«اشتراك» للحقول الكاملة والتحويل — التوصيل يبقى على مبلغه المعلوماتي
  const saleGross = isDelivery ? 0 : (sale ?? 0);
  const subAmountVal = isDelivery ? null : (subscription ?? 0);

  // سحب كود المكافأة (اختياري): يخصم من «المبيع» حصراً — لا يلمس «اشتراك» أبداً.
  // التوصيل مستثنى (مكافأته عند التفعيل — مصدره المالي الوحيد).
  let rewardSubId: number | null = null;
  if (useReward && !isDelivery && saleGross > 0 && towerId) {
    const off = await prisma.tower.findUnique({ where: { id: towerId }, select: { rewardsEnabled: true } });
    if (off?.rewardsEnabled === "1") rewardSubId = matchedSub?.id ?? null;
  }

  // ⚠️ «اشتراك» بلا أي أثر مالي (نمط التوصيل): يُخزَّن على البطاقة ويظهر بذمة الفني
  // ونافذة الاكمال فقط — تسجيله المالي الوحيد عند تفعيل الاشتراك من المستخدم.
  // و«المبيع» أثره المالي الوحيد فاتورة المبيع أدناه — لا مبيعات/نثرية بعد اليوم.

  let rewardDiscount = 0;
  let netSale = 0;
  let invoiceId: number | null = null;
  let invoiceNumber: number | null = null;
  await prisma.$transaction(async (tx) => {
    // خصم كود المكافأة من «المبيع» أولاً (بحدّه، ويبقى الباقي للمشترك)
    if (rewardSubId) {
      const r = await redeemReward(tx, {
        subscriberId: rewardSubId, billAmount: saleGross, context: "maintenance", refId: cardId,
        towerId, agentId: actor.agentId ?? null, createdByUser: String(actor.userId ?? ""), createdByName: actor.name ?? undefined,
      });
      rewardDiscount = r?.discount ?? 0;
    }
    // «المبيع» الصافي بعد الخصم = المُحصَّل فعلاً من الزبون عن المواد
    netSale = Math.max(0, saleGross - rewardDiscount);

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
    // ===== فاتورة المبيع الحقيقية — السجل المالي الوحيد للمبيع (لا مبيعات/نثرية) =====
    // أسعار السطور تُوزَّع نسبياً على «المبيع» الصافي (نقصاً وزيادة): 20 ألفاً لمادتين
    // عُدّل إلى 15 ⇒ كل سطر ×(15÷20)؛ زاد إلى 25 ⇒ ×(25÷20). كسور التقريب على آخر سطر.
    if (!isDelivery && soldInfo.length > 0) {
      const lineTotals = soldInfo.map((s) => s.price * s.qty);
      const scaled = soldInfo.map((_, i) =>
        materialsTotal > 0 ? Math.round((lineTotals[i] * netSale) / materialsTotal) : (i === 0 ? netSale : 0));
      const diff = netSale - scaled.reduce((a, b) => a + b, 0);
      if (scaled.length) scaled[scaled.length - 1] += diff;

      const last = await tx.invoice.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
      invoiceNumber = (last?.number ?? 0) + 1;
      const inv = await tx.invoice.create({
        data: {
          date: new Date(), number: invoiceNumber,
          itemsCount: soldInfo.reduce((s, x) => s + x.qty, 0),
          totalMy: netSale, waselHim: netSale,
          note: `مبيع صيانة — تكت #${cardId} («${card.kind ?? ""}») — الفني ${tech?.name ?? ""}` +
            (rewardDiscount > 0 ? ` (مكافأة −${rewardDiscount.toLocaleString("en-US")} من ${saleGross.toLocaleString("en-US")})` : ""),
          user: actor.name, type: "بيع صيانة", subscriberId: matchedSub?.id ?? null, towerId,
        },
      });
      invoiceId = inv.id;
      for (let i = 0; i < soldInfo.length; i++) {
        const s = soldInfo[i];
        await tx.invoiceItem.create({
          data: { invoiceId: inv.id, itemId: s.itemId, count: s.qty, price: s.qty > 0 ? scaled[i] / s.qty : 0 },
        });
      }
      // قيد قبض الفاتورة (كفاتورة المبيع العادية) — المرة الوحيدة التي يدخل فيها المبيع الصندوق
      if (netSale > 0) {
        await tx.moneyTx.create({
          data: {
            moneyIn: netSale, moneyOut: 0, date: new Date(), serverDate: new Date(),
            userId: actor.userId, sourceType: "invoice", sourceId: inv.id, towerId,
            notes: `فاتورة بيع صيانة #${invoiceNumber} — تكت #${cardId}`,
          },
        });
      }
    }
    // حفظ الصورة (تُحذف مع البطاقة/التحصيل)
    if (photo?.trim()) {
      await tx.cardPhoto.upsert({
        where: { cardId }, update: { data: photo }, create: { cardId, data: photo },
      });
    }
    // إنجاز البطاقة — amount = «المبيع» الصافي (وللتوصيل مبلغه)، subAmount = «اشتراك»
    await tx.taskCard.update({
      where: { id: cardId },
      data: {
        done: true, completedAt: new Date(), durationSec,
        amount: isDelivery ? (amount ?? 0) : netSale,
        subAmount: subAmountVal,
        serviceDetails: (serviceDetails?.trim() || null) ? `${serviceDetails!.trim()}${rewardDiscount > 0 ? `\n(خصم مكافأة: ${rewardDiscount} د.ع)` : ""}` : (rewardDiscount > 0 ? `(خصم مكافأة: ${rewardDiscount} د.ع)` : null),
        materialsInfo: soldInfo.length ? JSON.stringify(soldInfo) : null,
      },
    });
  });

  // سجل التغييرات داخل البطاقة + المجموع المستلم من الفني (مبيع + اشتراك؛ وللتوصيل مبلغه)
  const totalReceived = isDelivery ? (amount ?? 0) : netSale + (subAmountVal ?? 0);
  const amountsLabel = isDelivery
    ? `المبلغ ${(amount ?? 0).toLocaleString("en-US")} د.ع`
    : `مبيع ${netSale.toLocaleString("en-US")} + اشتراك ${(subAmountVal ?? 0).toLocaleString("en-US")} د.ع`;
  await appendCardHistory(cardId, actor.name, `إنجاز البطاقة — ${amountsLabel}`);

  // إشعار إنجاز البطاقة (جرس + Push للهاتف/المتصفح حتى والبرنامج مغلق) — لا يضيع أي إنجاز
  await notify({
    agentId: actor.agentId ?? null, towerId, type: "cardDone",
    title: `✅ أُنجزت بطاقة «${card.kind ?? "مهمة"}»`,
    body: `${card.title}${actor.name ? ` — بواسطة ${actor.name}` : ""}${totalReceived > 0 ? ` — ${amountsLabel}` : ""}`,
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
      details: `إنجاز بطاقة «${card.title}» (${card.kind}) — فني ${tech?.name ?? card.technicianId} — مكتب ${towerId ?? "?"} — ${amountsLabel} — بواسطة ${actor.isTech ? "الفني نفسه" : (actor.name || "المكتب")}`,
    },
  }).catch(() => {});

  // ===== ما بعد الإنجاز (لا يُفشل الإنجاز إن تعثّر): سجل الصيانات + رسالة واتساب =====
  // الرسالة تُرسَل عند إنجاز أي نوع (توصيل/تحويل/صيانة/…) — المطابقة تمت أعلاه مرة واحدة
  let matchedSubscriber: number | null = null;
  let messaged = false;
  try {
    const sub = matchedSub;
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
            technicianName: tech?.name ?? null, cardTitle: card.title, kind: card.kind, durationSec, amount: netSale, date: new Date(),
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
            amount: netSale,
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
            details: serviceDetails?.trim() ?? "", date: formatDate(new Date()),
            // {amount} = المجموع المستلم؛ {المبيع}/{الاشتراك} تفصيلاً (وللتوصيل مبلغه في amount)
            amount: totalReceived, sale: netSale, subscription: subAmountVal ?? 0,
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

  // (أُلغيت الفاتورة «التوثيقية» القديمة — الفاتورة الحقيقية تُنشأ داخل المعاملة أعلاه
  //  وهي السجل المالي الوحيد للمبيع)

  return NextResponse.json({
    ok: true, sale: netSale, subscription: subAmountVal, rewardDiscount,
    invoiceId, invoiceNumber, hasPhoto: !!photo, matchedSubscriber, messaged, overrun: overrunResult,
  });
}
