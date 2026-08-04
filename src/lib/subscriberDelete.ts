import { prisma } from "@/lib/prisma";

// ===== حذف المشترك: تعطيلٌ لا محو (قرار محمد 2026-08-05) =====
// كان الحذف **فيزيائياً**: يمحو من القاعدة حركات الصندوق (دين + تفعيل + فاتورة)
// وبنود الفواتير والفواتير والوصولات والرسائل والمشترك — فينقص تقرير يومٍ مضى
// بمقدار ما كان لذلك المشترك فيه، **بلا أي أثر يشرح لماذا**، وبلا قيد تدقيق واحد.
//
// وأخطر: لم يكن يمسّ حركات الماستر المرتبطة بوصولاته (master و master-invoice)
// ولا مبيعات المخزن (sale) — فيبقى في القاعدة مالُ ماستر يشير إلى وصلٍ لم يعد له
// وجود: يتيمٌ لا يُربط بأحد ولا يُفسَّر.
//
// الآن: يُعطَّل المشترك وحده (isDeleted) فيختفي من كل القوائم والرسائل والتقارير
// الحيّة، **ولا يُلمس أي وصل ولا فاتورة ولا حركة مالية** — فتبقى تقارير الأيام
// الماضية كما هي بالدينار، ويبقى كل شيء مترابطاً فلا يتيم بعد اليوم.

export type PurgeActor = { userId?: number | null; name?: string | null };

export async function purgeSubscribers(ids: number[], actor?: PurgeActor): Promise<{ deleted: number }> {
  if (!ids.length) return { deleted: 0 };

  // ما الذي سيُخفى؟ يُسجَّل قبل التعطيل كي يُعرف لاحقاً ماذا اختفى وبكم
  const [subs, entryAgg, invAgg] = await Promise.all([
    prisma.subscriber.findMany({
      where: { id: { in: ids }, isDeleted: false },
      select: { id: true, name: true, netUser: true, towerId: true, carry: true },
    }),
    prisma.subscriptionEntry.aggregate({
      where: { subscriberId: { in: ids }, isDeleted: false },
      _count: true, _sum: { moneyIn: true },
    }),
    prisma.invoice.aggregate({
      where: { subscriberId: { in: ids }, isDeleted: false },
      _count: true, _sum: { waselHim: true },
    }),
  ]);
  if (!subs.length) return { deleted: 0 };

  const count = await prisma.$transaction(async (tx) => {
    // التعطيل وحده — لا حذف لأي سجل مالي
    const upd = await tx.subscriber.updateMany({
      where: { id: { in: subs.map((s) => s.id) }, isDeleted: false },
      data: { isDeleted: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actor?.userId ?? null,
        action: "DELETE_SUBSCRIBER",
        entity: "subscriber",
        entityId: subs.length === 1 ? String(subs[0].id) : String(subs.length),
        details:
          "تعطيل " + subs.length + " مشترك" +
          (subs.length <= 5 ? " (" + subs.map((s) => s.name ?? s.netUser ?? String(s.id)).join("، ") + ")" : "") +
          " — وصولات محفوظة: " + (entryAgg._count || 0) +
          " بمجموع " + (entryAgg._sum.moneyIn ?? 0).toLocaleString("en-US") +
          " · فواتير: " + (invAgg._count || 0) +
          " بمجموع " + (invAgg._sum.waselHim ?? 0).toLocaleString("en-US") +
          " · ديون لحظة الحذف: " + subs.reduce((s2, s) => s2 + (s.carry ?? 0), 0).toLocaleString("en-US") +
          " — لم يُحذف أي وصل ولا حركة مالية، وتقارير الأيام الماضية لم تتغيّر" +
          (actor?.name ? " — بواسطة " + actor.name : ""),
      },
    });

    return upd.count;
  });

  return { deleted: count };
}

// استرجاع مشترك مُعطَّل — يعود كما كان بكل وصولاته لأنها لم تُمَس أصلاً
export async function restoreSubscribers(ids: number[], actor?: PurgeActor): Promise<{ restored: number }> {
  if (!ids.length) return { restored: 0 };
  const upd = await prisma.subscriber.updateMany({
    where: { id: { in: ids }, isDeleted: true },
    data: { isDeleted: false },
  });
  if (upd.count > 0) {
    await prisma.auditLog.create({
      data: {
        userId: actor?.userId ?? null,
        action: "RESTORE_SUBSCRIBER", entity: "subscriber",
        entityId: ids.length === 1 ? String(ids[0]) : String(upd.count),
        details: "استرجاع " + upd.count + " مشترك" + (actor?.name ? " — بواسطة " + actor.name : ""),
      },
    });
  }
  return { restored: upd.count };
}

// ===== المسح النهائي (قرار محمد 2026-08-05) =====
// «لا يؤثر على أي وصولات سابقة» — شرطه المكرَّر. لذلك المسح النهائي **لا يحذف**
// وصلاً ولا فاتورة ولا حركة مالية ولا يمسّ تقرير يومٍ مضى بدينار.
// ما يُمحى: كل بيانات المشترك الشخصية والفنية (الهاتف والعنوان واليوزر وكلمات
// السر والملاحظات ومعرّف SAS). وما يبقى: **اسمه وحده** — لأن الوصل بلا اسم صاحبه
// وصلٌ لا يُقرأ، وهذا اختياره الصريح.
// ولا استرجاع بعده: purgedAt يُختم فيخرج من الأرشيف نهائياً.
export async function purgeSubscribersFinal(ids: number[], actor?: PurgeActor): Promise<{ purged: number }> {
  if (!ids.length) return { purged: 0 };

  const subs = await prisma.subscriber.findMany({
    where: { id: { in: ids }, purgedAt: null },
    select: { id: true, name: true, netUser: true, carry: true },
  });
  if (!subs.length) return { purged: 0 };

  const targetIds = subs.map((s) => s.id);
  const [entryAgg, invAgg] = await Promise.all([
    prisma.subscriptionEntry.aggregate({ where: { subscriberId: { in: targetIds }, isDeleted: false }, _count: true, _sum: { moneyIn: true } }),
    prisma.invoice.aggregate({ where: { subscriberId: { in: targetIds }, isDeleted: false }, _count: true }),
  ]);

  const count = await prisma.$transaction(async (tx) => {
    const upd = await tx.subscriber.updateMany({
      where: { id: { in: targetIds }, purgedAt: null },
      data: {
        isDeleted: true,
        purgedAt: new Date(),
        // تُمحى البيانات كلها — ويبقى name كما هو
        phone: null, address: null, netUser: null, note: null, sasId: null,
        wifiUser: null, wifiPass: null, subPassword: null,
        userNano: null, passNano: null, ipNano: null,
        telegram: null, sector: null, affiliate: null, ftth: null, employee: null,
        rewardCode: null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actor?.userId ?? null,
        action: "PURGE_SUBSCRIBER", entity: "subscriber",
        entityId: subs.length === 1 ? String(subs[0].id) : String(subs.length),
        details:
          "مسح نهائي لـ" + subs.length + " مشترك" +
          (subs.length <= 5 ? " (" + subs.map((s) => s.name ?? s.netUser ?? String(s.id)).join("، ") + ")" : "") +
          " — مُحيت بياناتهم وبقيت أسماؤهم على وصولاتهم. " +
          "وصولات محفوظة: " + (entryAgg._count || 0) +
          " بمجموع " + (entryAgg._sum.moneyIn ?? 0).toLocaleString("en-US") +
          " · فواتير: " + (invAgg._count || 0) +
          " — لم يُحذف أي وصل ولا حركة مالية" +
          (actor?.name ? " — بواسطة " + actor.name : ""),
      },
    });
    return upd.count;
  });

  return { purged: count };
}
