import { NextResponse } from "next/server";
import { requireTower } from "@/lib/requireTower";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { redeemReward, sendRewardUsedMessage } from "@/lib/rewards";

const schema = z.object({
  subscriberId: z.coerce.number().optional().nullable(), // إلزامي إلا مع البيع المباشر
  direct: z.boolean().optional().default(false), // بيع مباشر: بلا مشترك (نقدي)
  // بيع ماستر (محمد 2026-07-29): يرتبط بحساب الماستر المستقل — لا يدخل التقرير اليومي.
  // masterAmount للدفع المختلط: جزء ماستر + جزء نقدي (paid)؛ 0 = كل المبلغ ماستر.
  master: z.boolean().optional().default(false),
  masterAmount: z.coerce.number().min(0).default(0),
  customerName: z.string().max(120).optional().nullable(), // اسم الزبون (اختياري للبيع المباشر)
  items: z
    .array(
      z.object({
        itemId: z.coerce.number(),
        count: z.coerce.number().positive(),
        price: z.coerce.number().min(0),
      }),
    )
    .min(1, "أضف مادة واحدة على الأقل"),
  note: z.string().nullable().optional(),
  paid: z.coerce.number().min(0).default(0),
  useReward: z.boolean().optional().default(false), // سحب كود مكافأة المشترك خصماً
});

// سجل وصولات فواتير المبيع — مع اسم المشترك/الزبون.
// العزل: فواتير مكاتب وكيل المستخدم فقط (+ فواتير بلا مكتب أنشأها هو) — كانت بلا فلترة
export async function GET(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;

  // سقف 200 كان يخفي فواتير داخلة في المجاميع، والبحث يجري في المتصفح على المحمّل
  // وحده — فأي فاتورة أقدم لا يمكن بلوغها ولا حذفها (تدقيق 2026-08-04).
  const sp = new URL(request.url).searchParams;
  const withMeta = sp.get("meta") === "1";
  const take = Math.min(2000, Math.max(1, Number(sp.get("take")) || 500));
  const { towerScope } = await import("@/lib/guard");
  const scope = await towerScope(g.session);

  // ═════ أ-١٨ · البحثُ الحرُّ — كان **يُرسَل ولا يُقرَأ** (2026-08-13) ═════
  // 🔴 `receipts/page.tsx` تُرسل `q` إلى هذا المسار بالنمط الصحيح (مُهدَّأً ومربوطاً
  //   بالحالة)، وهذا المسارُ **لم يقرأه إطلاقاً** ⇒ الكتابةُ في صندوق البحث بتبويب
  //   «الفواتير» لا تُغيّر شيئاً، بينما تبويبُ «الاشتراكات» يبحث فعلاً (`/api/subscriptions`
  //   يقرأ `q`). فالمستخدمُ يرى ميزةً تعمل في تبويبٍ وتُهمَل في آخرَ بلا رسالة —
  //   و`matched` يُحسَب على الكلّ فيُطمئنه كذباً بأنّ البحثَ «لم يجد شيئاً يُقصّ».
  // ⇒ نُنفّذه بنفسِ نمطِ `/api/subscriptions` حرفيّاً ليكون سلوكُ التبويبَين واحداً:
  //   نصٌّ يُطابَق في حقول الفاتورة النصّيّة، ورقمٌ يُطابَق في المُعرِّف والرقم والمبلغ،
  //   واسمُ المشترك/يوزرُه عبر مطابقةٍ مسبقةٍ على `subscribers` (لا علاقةَ في السكيمة).
  // 🔒 والعزلُ لا يُمَسّ: `qWhere` يُضاف **إلى جانب** `scope` في `AND` لا يُبدله.
  const q = (sp.get("q") ?? "").trim();
  let qWhere: object = {};
  if (q) {
    const qNum = Number(q.replace(/[,،]/g, ""));
    // ⚠️ المطابقةُ المسبقةُ **مقيَّدةٌ بمشتركي نطاق المستخدم**: لولا التقييد لَجلبت
    //   مُعرِّفاتَ مشتركي وكلاءَ آخرين، ثمّ لَكشف `subscriberId: { in: … }` فواتيرَهم
    //   إن صادف أنّ مُعرِّفاً منها يقع في نطاقنا. القيدُ يمنع ذلك من أصله.
    const matchedSubs = await prisma.subscriber.findMany({
      where: {
        isDeleted: false,
        ...scope,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { netUser: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 5000,
    });
    qWhere = {
      OR: [
        { note: { contains: q, mode: "insensitive" } },
        { user: { contains: q, mode: "insensitive" } },
        { type: { contains: q, mode: "insensitive" } },
        ...(matchedSubs.length ? [{ subscriberId: { in: matchedSubs.map((x) => x.id) } }] : []),
        ...(Number.isFinite(qNum) && qNum > 0
          ? [{ id: qNum }, { number: qNum }, { totalMy: qNum }, { waselHim: qNum }]
          : []),
      ],
    };
  }

  const invWhere = {
    isDeleted: false,
    OR: [{ ...scope }, { towerId: null, user: g.session.username }],
    ...(q ? { AND: [qWhere] } : {}),
  };
  const invoices = await prisma.invoice.findMany({
    where: invWhere,
    orderBy: { id: "desc" },
    take,
  });
  const subIds = [...new Set(invoices.map((i) => i.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true } })
    : [];
  const nameMap = new Map(subs.map((s) => [s.id, s.name ?? s.netUser ?? `#${s.id}`]));
  // المواد المباعة لكل فاتورة — تظهر في كل سطر من سجل الوصولات (طلب محمد)
  const lines = await prisma.invoiceItem.findMany({
    where: { invoiceId: { in: invoices.map((i) => i.id) }, isDeleted: false },
    select: { invoiceId: true, itemId: true, count: true },
  });
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is number => x != null))];
  const itemName = new Map(
    (itemIds.length
      ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } })
      : []
    ).map((x) => [x.id, x.name ?? `مادة #${x.id}`]),
  );
  const itemsText = new Map<number, string>();
  for (const l of lines) {
    if (l.invoiceId == null) continue;
    const nm = l.itemId != null ? itemName.get(l.itemId) ?? "مادة" : "مادة";
    const part = (l.count ?? 1) > 1 ? `${nm} ×${l.count}` : nm;
    itemsText.set(l.invoiceId, itemsText.has(l.invoiceId) ? `${itemsText.get(l.invoiceId)}، ${part}` : part);
  }
  const rows = invoices.map((i) => ({
    ...i,
    subscriberName: i.subscriberId != null ? nameMap.get(i.subscriberId) ?? null : null,
    itemsText: itemsText.get(i.id) ?? null,
  }));

  // meta=1: العدّ الكامل والمجاميع على كل المطابق — لا على المعروض
  if (withMeta) {
    const [matched, agg] = await Promise.all([
      prisma.invoice.count({ where: invWhere }),
      prisma.invoice.aggregate({ where: invWhere, _sum: { totalMy: true, waselHim: true } }),
    ]);
    return NextResponse.json({
      rows,
      matched,
      sums: { value: agg._sum.totalMy ?? 0, collected: agg._sum.waselHim ?? 0 },
    });
  }

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { subscriberId, direct, master, masterAmount, customerName, items, note, paid, useReward } = parsed.data;

  if (direct && master) return NextResponse.json({ error: "اختر وضعاً واحداً: بيع مباشر أو بيع ماستر" }, { status: 400 });
  // المشترك إلزامي إلا في البيع المباشر/الماستر (نقديان بلا مشترك — لا دين ولا مكافأة)
  let subscriber: Awaited<ReturnType<typeof prisma.subscriber.findUnique>> = null;
  if (!direct && !master) {
    if (!subscriberId) return NextResponse.json({ error: "اختر المشترك أو فعّل «بيع مباشر»" }, { status: 400 });
    subscriber = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
    if (!subscriber || subscriber.isDeleted || !(await sameAgentTower(g.session, subscriber.towerId))) {
      return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
    }
  }
  const towerId = subscriber?.towerId ?? g.session.towerId ?? null;

  const total = items.reduce((s, it) => s + it.count * it.price, 0);
  const itemsCount = items.reduce((s, it) => s + it.count, 0);

  // أهلية سحب كود المكافأة: مفعّل للمكتب + رصيد للمشترك (لا مكافأة في البيع المباشر)
  let rewardEligible = false;
  if (!direct && subscriber && useReward && (subscriber.rewardBalance ?? 0) > 0) {
    const off = subscriber.towerId ? await prisma.tower.findUnique({ where: { id: subscriber.towerId }, select: { rewardsEnabled: true } }) : null;
    rewardEligible = off?.rewardsEnabled === "1";
  }

  // رقم الفاتورة التسلسلي
  const last = await prisma.invoice.findFirst({
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const number = (last?.number ?? 0) + 1;

  let rewardDiscount = 0;
  let invoice;
  try {
  {
    const e = requireTower(towerId, "الفاتورة");
    if (e) return e;
  }

  // دينٌ بلا مدين (المرحلة ٨): في الفاتورة بلا مشترك كان المتبقّي يُحسب ثم **لا يُطبَّق
  // على أحد** — فيظهر المبلغ مبيعاً في التقارير، لا هو في الصندوق ولا هو دين على أحد.
  // الآن: البيع بلا مشترك يجب أن يكون واصلاً بالكامل (أو ماستر). ومَن أراد تقسيطاً
  // يربط الفاتورة بمشترك فيُسجَّل الدين باسمه ويظهر في قائمة الديون.
  if (!subscriber && !master) {
    const grossTotal = items.reduce((s, it) => s + it.count * it.price, 0);
    if (paid < grossTotal) {
      return NextResponse.json(
        {
          error:
            `البيع بلا مشترك يجب أن يكون واصلاً بالكامل (${grossTotal.toLocaleString("en-US")}). ` +
            `الدين لا يمكن تسجيله على زبون غير مرتبط بحساب — اربط الفاتورة بمشترك ليُسجَّل الدين باسمه.`,
        },
        { status: 400 },
      );
    }
  }
    invoice = await prisma.$transaction(async (tx) => {
    // خصم كود المكافأة أولاً (بحدّ الإجمالي، يبقى الباقي للمشترك)
    if (rewardEligible && subscriber) {
      const r = await redeemReward(tx, {
        subscriberId: subscriber.id, billAmount: total, context: "sale", towerId: subscriber.towerId,
        agentId: session?.agentId ?? null, createdByUser: session?.username, createdByName: session?.fullName ?? undefined,
      });
      rewardDiscount = r?.discount ?? 0;
    }
    const netTotal = Math.max(0, total - rewardDiscount); // المستحقّ بعد المكافأة
    // بيع ماستر: كامل (masterAmount=0) أو مختلط «نقدي + ماستر» — يغطّي المجموع تماماً بلا دين
    const masterPart = master ? (masterAmount > 0 ? masterAmount : netTotal) : 0;
    const cashPart = master ? (masterAmount > 0 ? paid : 0) : paid;
    if (master && cashPart + masterPart !== netTotal) {
      throw new Error(`MASTER_MISMATCH:${cashPart}:${masterPart}:${netTotal}`);
    }
    const remainder = master ? 0 : Math.max(0, netTotal - paid); // الدين على المشترك من هذه الفاتورة
    // ب-٠٠ · الحرجة ٥: الزائدُ عن المستحقّ **ليس إيراداً لهذه الفاتورة** بل رصيدٌ للمشترك
    const overpaid = master ? 0 : Math.max(0, paid - netTotal);

    const buyer = master ? (customerName?.trim() || "بيع ماستر") : direct ? (customerName?.trim() || "بيع مباشر") : (subscriber?.name ?? subscriber?.id ?? "");
    const inv = await tx.invoice.create({
      data: {
        date: new Date(),
        number,
        itemsCount,
        totalMy: netTotal,
        // الماستر واصل بالكامل (نقدي + ماستر يغطيان المجموع — بلا دين)
        // ب-٠٠ · ومسقوفٌ بالمستحقّ: الزائدُ رصيدٌ للمشترك لا إيرادٌ لهذه الفاتورة
        waselHim: master ? netTotal : Math.min(paid, netTotal),
        note: [
          (direct || master) && customerName?.trim() ? `الزبون: ${customerName.trim()}` : "",
          note ?? "",
          rewardDiscount > 0 ? `(مكافأة −${rewardDiscount.toLocaleString("en-US")} من إجمالي ${total.toLocaleString("en-US")})` : "",
        ].filter(Boolean).join(" — ") || null,
        user: session?.username,
        userId: session?.userId ?? null, // للتقرير اليومي لكلّ مستخدم
        type: master ? "ماستر" : direct ? "بيع مباشر" : "بيع",
        subscriberId: subscriber?.id ?? null,
        towerId,
      },
    });

    for (const it of items) {
      await tx.invoiceItem.create({
        data: { invoiceId: inv.id, itemId: it.itemId, count: it.count, price: it.price },
      });
      // إنقاص المخزون
      await tx.item.update({ where: { id: it.itemId }, data: { count: { decrement: it.count } } });
    }

    // تسجيل القبض: الماستر لحسابه المستقل (لا يدخل التقرير اليومي)، والنقدي للصندوق
    if (masterPart > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: masterPart, moneyOut: 0,
          notes: `ماستر فاتورة #${number} - ${buyer}${cashPart > 0 ? ` (مختلط: نقدي ${cashPart.toLocaleString("en-US")})` : ""}`,
          date: new Date(), serverDate: new Date(), userId: session?.userId,
          sourceType: "master-invoice", sourceId: inv.id, towerId,
        },
      });
    }
    if (cashPart > 0) {
      await tx.moneyTx.create({
        data: {
          moneyIn: cashPart, moneyOut: 0,
          notes: `فاتورة بيع #${number} - ${buyer}${master ? " (نقدي من مختلط ماستر)" : ""}`,
          date: new Date(), serverDate: new Date(), userId: session?.userId,
          sourceType: "invoice", sourceId: inv.id, towerId,
        },
      });
    }

    // إضافة المتبقّي كدين على المشترك (فواتير بالدين) — البيع المباشر بلا دين (نقدي)
    if (remainder > 0 && subscriber) {
      await tx.subscriber.update({
        where: { id: subscriber.id },
        data: { carry: (subscriber.carry ?? 0) + remainder },
      });
    }
    // ===== ب-٠٠ · الحرجة ٥: الواصلُ الزائدُ **رصيدٌ للمشترك لا إيرادُ الفاتورة** =====
    // `waselHim` كان يأخذ `paid` بلا سقف: مَن دفع ٦٠٬٠٠٠ لفاتورةٍ بـ٥٠٬٠٠٠ تُقيَّد العشرةُ آلافٍ
    // **إيراداً لهذه الفاتورة** ⇒ يتضخّم إيرادُ المبيع في التقرير، ويضيع حقُّ المشترك.
    // الآن: `waselHim` مسقوفٌ بالمستحقّ (أعلاه)، والزائدُ **رصيدٌ له** (`carry` سالب) كما في
    // الحرجة ١ — ومالُ الصندوق يبقى `paid` كاملاً فلا يختلف عمّا في الدرج.
    if (overpaid > 0) {
      if (subscriber) {
        await tx.subscriber.update({
          where: { id: subscriber.id },
          data: { carry: { decrement: overpaid } },
        });
      }
      // بيعٌ مباشرٌ بلا مشترك: لا أحدَ يُقيَّد له الرصيد ⇒ يُذكَر في التدقيق كي لا يمرّ صامتاً
      await tx.auditLog.create({
        data: {
          userId: session?.userId, action: "INVOICE_OVERPAID", entity: "invoice", entityId: String(inv.id),
          details: `فاتورة #${number}: دُفع ${paid} والمستحقّ ${netTotal} ⇒ زائدٌ ${overpaid}`
            + (subscriber ? ` قُيّد رصيداً للمشترك ${subscriber.id}` : " — بيعٌ مباشرٌ بلا مشترك، فلم يُقيَّد لأحد. راجِعه"),
        },
      }).catch(() => {});
    }

    return inv;
    });
  } catch (e) {
    const m = /^MASTER_MISMATCH:(\d+):(\d+):(\d+)$/.exec((e as Error).message ?? "");
    if (m) {
      return NextResponse.json(
        { error: `النقدي (${Number(m[1]).toLocaleString("en-US")}) + الماستر (${Number(m[2]).toLocaleString("en-US")}) يجب أن يساوي المجموع (${Number(m[3]).toLocaleString("en-US")}) — بيع الماستر بلا دين` },
        { status: 400 },
      );
    }
    throw e;
  }

  // رسالة تأكيد استخدام المكافأة (أفضل جهد) — لا تحدث في البيع المباشر
  if (rewardDiscount > 0 && subscriber) {
    const rs = await prisma.subscriber.findUnique({ where: { id: subscriber.id }, select: { phone: true, waEnabled: true, name: true, rewardBalance: true } });
    if (rs) void sendRewardUsedMessage({
      subscriberId: subscriber.id, officeId: subscriber.towerId, agentId: session?.agentId ?? null,
      phone: rs.phone, waEnabled: rs.waEnabled, name: rs.name, discount: rewardDiscount, balance: rs.rewardBalance ?? 0, createdByUser: session?.username,
    });
  }

  return NextResponse.json(invoice, { status: 201 });
}
