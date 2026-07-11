import { NextResponse } from "next/server";
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

  const subId = new URL(request.url).searchParams.get("subscriberId");
  const entries = await prisma.subscriptionEntry.findMany({
    where: {
      isDeleted: false,
      ...towerScope(g.session),
      ...(subId ? { subscriberId: Number(subId) } : {}),
    },
    orderBy: { id: "desc" },
    take: 100,
  });

  const ids = [...new Set(entries.map((e) => e.subscriberId).filter(Boolean))];
  const subs = await prisma.subscriber.findMany({
    where: { id: { in: ids as number[] } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(subs.map((s) => [s.id, s.name]));

  return NextResponse.json(
    entries.map((e) => ({
      ...e,
      subscriberName: e.subscriberId ? nameMap.get(e.subscriberId) : null,
    })),
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
  if (!subscriber || subscriber.isDeleted || !ownsTower(g.session, subscriber.towerId)) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }
  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
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
      },
    }),
    prisma.subscriber.update({
      where: { id: subscriberId },
      data: {
        packageId,
        dateFrom: subscriber.dateFrom ?? calc.dateFrom,
        dateTo: calc.dateTo,
        carry: calc.newCarry,
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
            },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ...entry, calc }, { status: 201 });
}
