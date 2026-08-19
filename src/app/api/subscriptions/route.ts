import { NextResponse } from "next/server";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";
import { requireTower } from "@/lib/requireTower";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, towerScope, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { computeActivation } from "@/lib/subscription";

const schema = z.object({
  subscriberId: z.coerce.number(),
  packageId: z.coerce.number(),
  months: z.coerce.number().min(1).default(1),
  paid: z.coerce.number().min(0).default(0),
  date: z.string().optional(), // تاريخ العملية (ISO)
  notes: z.string().nullable().optional(),
});

// قائمة آخر عمليات التفعيل مع أسماء المشتركين
export async function GET(request: Request) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;

  // سقف 100 كان يخفي وصولات داخلة في المجاميع ولا يمكن بلوغها ولا حذفها، والبحث
  // كان يجري في المتصفح على المحمّل وحده فوصلٌ أقدم لا يُبحث عنه أبداً (تدقيق 2026-08-04).
  // الآن: بحث وتاريخ من الخادم + عدّ كامل + مجاميع على كل المطابق لا على المعروض.
  const sp = new URL(request.url).searchParams;
  const subId = sp.get("subscriberId");
  const q = (sp.get("q") ?? "").trim();
  const fromStr = sp.get("from");
  const toStr = sp.get("to");
  const withMeta = sp.get("meta") === "1";
  const take = Math.min(2000, Math.max(1, Number(sp.get("take")) || 500));

  const dateFilter: { gte?: Date; lte?: Date } = {};
  // ب-٨ · بدايةُ اليوم ونهايتُه **بتوقيت بغداد** لا بتوقيت الخادم (UTC)
  { const d = baghdadStart(fromStr); if (d) dateFilter.gte = d; }
  { const d = baghdadEnd(toStr); if (d) dateFilter.lte = d; }

  // البحث الحر: اسم المشترك أو يوزره، أو الفئة، أو رقم الوصل، أو المبلغ
  let qWhere: object = {};
  if (q) {
    const qNum = Number(q.replace(/[,،]/g, ""));
    const matchedSubs = await prisma.subscriber.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { netUser: { contains: q, mode: "insensitive" } }] },
      select: { id: true },
      take: 5000,
    });
    qWhere = {
      OR: [
        { cardType: { contains: q, mode: "insensitive" } },
        ...(matchedSubs.length ? [{ subscriberId: { in: matchedSubs.map((x) => x.id) } }] : []),
        ...(Number.isFinite(qNum) && qNum > 0 ? [{ id: qNum }, { money: qNum }, { moneyIn: qNum }] : []),
      ],
    };
  }

  const where = {
    isDeleted: false,
    ...(await towerScope(g.session)),
    ...(subId ? { subscriberId: Number(subId) } : {}),
    ...(dateFilter.gte || dateFilter.lte ? { date: dateFilter } : {}),
    ...(q ? qWhere : {}),
  };

  const entries = await prisma.subscriptionEntry.findMany({ where, orderBy: { id: "desc" }, take });

  const ids = [...new Set(entries.map((e) => e.subscriberId).filter(Boolean))];
  const subs = await prisma.subscriber.findMany({
    where: { id: { in: ids as number[] } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(subs.map((s) => [s.id, s.name]));

  const rows = entries.map((e) => ({
    ...e,
    subscriberName: e.subscriberId ? nameMap.get(e.subscriberId) : null,
  }));

  // meta=1: شكل موسّع للسجلات التي تحتاج العدّ والمجاميع الكاملة. وبدونها تبقى
  // الاستجابة مصفوفةً كما كانت — فلا تنكسر الشاشات التي تستهلكها اليوم.
  if (withMeta) {
    const [matched, agg] = await Promise.all([
      prisma.subscriptionEntry.count({ where }),
      prisma.subscriptionEntry.aggregate({ where, _sum: { money: true, moneyIn: true, addPrice: true } }),
    ]);
    return NextResponse.json({
      rows,
      matched,
      sums: {
        value: (agg._sum.money ?? 0) + (agg._sum.addPrice ?? 0),
        collected: agg._sum.moneyIn ?? 0,
      },
    });
  }

  return NextResponse.json(
    rows,
  );
}

// تنفيذ تفعيل/تجديد اشتراك
export async function POST(request: Request) {
  const g = await guard("subscriptions.manage");
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
  const { subscriberId, packageId, months, paid, date, notes } = parsed.data;

  const subscriber = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
  });
  if (!subscriber || subscriber.isDeleted || !(await ownsTower(g.session, subscriber.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }
  // عزل المستأجر: الباقة من باقات وكيل المستخدم حصراً (تدقيق 2026-08-02)
  const pkg = await prisma.package.findFirst({ where: { id: packageId, agentId: g.session?.agentId ?? -1 } });
  if (!pkg || pkg.isDeleted) {
    return NextResponse.json({ error: "الباقة غير موجودة" }, { status: 404 });
  }

  const packagePrice = pkg.priceDinar ?? 0;
  const activationDate = date ? new Date(date) : new Date();
  const calc = computeActivation({
    packagePrice,
    months,
    previousCarry: subscriber.carry ?? 0,
    paid,
    currentDateTo: subscriber.dateTo,
    activationDate,
  });

  // إنشاء الوصل وتحديث المشترك في معاملة واحدة
  {
    const e = requireTower(subscriber.towerId, "وصل التفعيل");
    if (e) return e;
  }
  const [entry] = await prisma.$transaction([
    prisma.subscriptionEntry.create({
      data: {
        subscriberId,
        date: activationDate,
        dateFrom: calc.dateFrom,
        dateTo: calc.dateTo,
        money: calc.total,
        moneyIn: paid,
        moneyCarry: calc.newCarry,
        moneyType: 1, // تفعيل
        month: String(months),
        cardType: pkg.name,
        towerId: subscriber.towerId,
        priceDollar: pkg.priceDollar,
        notes: notes ?? null,
        createdByUser: session?.username,
        userId: session?.userId ?? null, // للتقرير اليومي لكلّ مستخدم
      },
    }),
    prisma.subscriber.update({
      where: { id: subscriberId },
      data: {
        packageId,
        dateFrom: subscriber.dateFrom ?? calc.dateFrom,
        dateTo: calc.dateTo,
        // 🔴 حرِجة ٣ · دَينٌ ذرّيّ: كان `carry: calc.newCarry` مطلقاً. والفارقُ (total-paid)
        //   مستقلٌّ عن القديم (newCarry = previousCarry + total - paid) ⇒ إضافةٌ ذرّيّة.
        carry: { increment: calc.total - paid },
        month: months,
        wasel: paid,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: session?.userId,
        action: "ACTIVATE",
        entity: "subscriber",
        entityId: String(subscriberId),
        details: `تفعيل ${months} شهر - ${pkg.name} - دفع ${paid}`,
      },
    }),
    // تسجيل المبلغ المدفوع كقبض في الصندوق
    ...(paid > 0
      ? [
          prisma.moneyTx.create({
            data: {
              moneyIn: paid,
              moneyOut: 0,
              notes: `تفعيل اشتراك - ${subscriber.name ?? subscriberId} (${pkg.name})`,
              date: activationDate,
              serverDate: new Date(),
              userId: session?.userId,
              // تصنيف تفعيل — كي لا تُحسب ضمن اليدوي في صفحة/بطاقة المصروفات والمقبوضات
              sourceType: "activation",
              towerId: subscriber.towerId,
            },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ...entry, calc }, { status: 201 });
}
