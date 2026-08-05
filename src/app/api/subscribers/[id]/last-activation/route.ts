import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ===== تحذير التفعيل المكرّر (طلب محمد 2026-08-05) =====
// مشتركٌ فُعِّل قبل أيام قليلة ثم يُفعَّل ثانيةً = مالٌ يُقبض مرّتين أو وصلٌ خطأ — ولم يكن
// في البرنامج ما ينبّه: تضغط «تفعيل» فتُفتح الشاشة كأنّ شيئاً لم يكن. هذا المسار يُخبر
// عن **آخر تفعيل خلال ٧ أيام** ليُعرض قبل فتح شاشة التفعيل.
//
// تمييز التفعيل عن غيره: وصل التفعيل وحده يحمل تاريخ انتهاء (dateTo) — أمّا «إضافة ديون
// سابقة» فتُنشئ وصلاً بلا تاريخين، فلا تُحسب تفعيلاً ولا تُنذر بغير حق.
const WINDOW_DAYS = 7;

// فرق الأيام **بالتقويم** لا بالساعات: تفعيلٌ أمس 23:00 «قبل يوم» لا «اليوم»
const dayKey = (d: Date) => {
  const b = new Date(d.getTime() + 3 * 3600 * 1000); // بغداد = UTC+3
  return Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("subscriptions.manage");
  if (g.error) return g.error;

  const { id } = await params;
  const subscriberId = Number(id);
  if (!subscriberId) return NextResponse.json({ error: "معرّف غير صالح" }, { status: 400 });

  const sub = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { id: true, name: true, netUser: true, towerId: true },
  });
  if (!sub || !(await ownsTower(g.session, sub.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  const since = new Date(Date.now() - (WINDOW_DAYS + 1) * 24 * 3600 * 1000);
  const last = await prisma.subscriptionEntry.findFirst({
    where: { subscriberId, isDeleted: false, dateTo: { not: null }, date: { gte: since } },
    orderBy: { date: "desc" },
    select: { id: true, date: true, dateTo: true, cardType: true, moneyIn: true, createdByUser: true, isMaster: true },
  });
  if (!last?.date) return NextResponse.json({ recent: false });

  const days = Math.round((dayKey(new Date()) - dayKey(last.date)) / 86400000);
  if (days < 0 || days > WINDOW_DAYS) return NextResponse.json({ recent: false });

  return NextResponse.json({
    recent: true,
    days,
    entryId: last.id,
    at: last.date,
    dateTo: last.dateTo,
    packageName: last.cardType ?? null,
    moneyIn: last.moneyIn ?? 0,
    isMaster: last.isMaster ?? false,
    by: last.createdByUser ?? null,
    subscriber: sub.name ?? sub.netUser ?? String(sub.id),
  });
}
