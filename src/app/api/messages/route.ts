import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { renderTemplate, sendViaProvider, type Channel } from "@/lib/messaging";
import { formatDate } from "@/lib/format";

const schema = z.object({
  channel: z.enum(["SMS", "WHATSAPP", "TELEGRAM"]).default("SMS"),
  text: z.string().min(1, "نص الرسالة مطلوب"),
  target: z.enum(["all", "expiring", "debtors", "one", "list", "expiringRange", "search"]).default("all"),
  subscriberId: z.coerce.number().optional(),
  subscriberIds: z.array(z.coerce.number()).optional(), // للإرسال لقائمة محدّدة
  expiringDays: z.coerce.number().default(7),
  from: z.string().optional(), // تاريخ بداية (للمنتهين بين تاريخين)
  to: z.string().optional(), // تاريخ نهاية
  search: z.string().optional(), // بحث مخصّص في الاسم/اليوزر/الهاتف
});

// سجل الرسائل — عزل المستأجر (كان يعرض رسائل كل الوكلاء):
// رسائل مشتركي مكاتب وكيل المستخدم + الرسائل غير المرتبطة بمشترك التي أرسلها مستخدمو وكيله
export async function GET(request: Request) {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;

  const channel = new URL(request.url).searchParams.get("channel");
  const { agentTowerIds } = await import("@/lib/guard");
  const towers = new Set(await agentTowerIds(g.session));
  const agentUsers = await prisma.user.findMany({
    where: { agentId: g.session?.agentId ?? -1 },
    select: { username: true, id: true },
  });
  // بعض المسارات تسجّل اسم المستخدم وبعضها معرّفه الرقمي في createdByUser — والمجدول "scheduler"
  const senders = new Set<string>([...agentUsers.map((u) => u.username), ...agentUsers.map((u) => String(u.id))]);

  // لا علاقة مباشرة بين الرسالة والمشترك في المخطط — نجلب دفعة أكبر ثم نرشّح بمكاتب الوكيل
  const batch = await prisma.message.findMany({
    where: { ...(channel ? { channel: channel as Channel } : {}) },
    orderBy: { id: "desc" },
    take: 900,
  });
  const subIds = [...new Set(batch.map((m) => m.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, towerId: true } })
    : [];
  const subTower = new Map(subs.map((s) => [s.id, s.towerId]));
  const messages = batch
    .filter((m) => {
      if (m.subscriberId != null) {
        const tid = subTower.get(m.subscriberId);
        return tid != null && towers.has(tid);
      }
      return m.createdByUser != null && senders.has(m.createdByUser);
    })
    .slice(0, 300);
  return NextResponse.json(messages);
}

// إرسال رسالة (فردية أو جماعية)
export async function POST(request: Request) {
  const g = await guard("messaging.manage");
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
  const { channel, text, target, subscriberId, subscriberIds, expiringDays, from, to, search } = parsed.data;

  // تحديد المستلمين (مع فلترة المكتب: كل مستخدم يرسل لمشتركي مكتبه، الأدمن للكل)
  const scope = await towerScope(g.session);
  let where: Record<string, unknown> = { isDeleted: false, ...scope };
  if (target === "one" && subscriberId) {
    // عزل: حتى الإرسال الفردي محصور بمشتركي نطاق المستخدم (كان بلا فلترة)
    where = { id: subscriberId, isDeleted: false, ...scope };
  } else if (target === "list") {
    where = { isDeleted: false, ...scope, id: { in: subscriberIds ?? [] } };
  } else if (target === "debtors") {
    where = { isDeleted: false, ...scope, carry: { gt: 0 } };
  } else if (target === "expiring") {
    const limit = new Date();
    limit.setDate(limit.getDate() + expiringDays);
    where = { isDeleted: false, ...scope, dateTo: { not: null, lte: limit } };
  } else if (target === "expiringRange") {
    // المنتهون بين تاريخين
    const fromD = from ? new Date(from) : new Date(0);
    const toD = to ? new Date(to) : new Date();
    toD.setHours(23, 59, 59, 999);
    where = { isDeleted: false, ...scope, dateTo: { not: null, gte: fromD, lte: toD } };
  } else if (target === "search") {
    // بحث مخصّص في الاسم/اليوزر/الهاتف + نطاق تاريخ انتهاء اختياري (يُدمجان معاً)
    const q = (search ?? "").trim();
    let dateFilter: Record<string, unknown> = {};
    if (from || to) {
      const range: Record<string, unknown> = { not: null };
      if (from) range.gte = new Date(from);
      if (to) { const toD = new Date(to); toD.setHours(23, 59, 59, 999); range.lte = toD; }
      dateFilter = { dateTo: range };
    }
    where = {
      isDeleted: false, ...scope,
      ...(q ? { OR: [
        { name: { contains: q, mode: "insensitive" } },
        { netUser: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ] } : {}),
      ...dateFilter,
    };
  }

  // احترام خيار واتساب لكل مشترك في الإرسال الجماعي (يُستثنى الإرسال الفردي المتعمّد)
  if (channel === "WHATSAPP" && target !== "one") {
    where = { ...where, waEnabled: true };
  }

  const recipients = await prisma.subscriber.findMany({ where });
  if (recipients.length === 0) {
    return NextResponse.json({ error: "لا يوجد مستلمون مطابقون" }, { status: 400 });
  }

  // خريطة المكاتب (الاسم + تفعيل واتساب) لتحديد اسم المكتب لكل مشترك وجلسة واتساب مكتبه
  const offices = await prisma.tower.findMany({ select: { id: true, name: true, waEnabled: true } });
  const officeMap = new Map(offices.map((o) => [o.id, o]));
  // اسم النظام الافتراضي من إعدادات وكيل المُرسِل حصراً (عزل الوكلاء)
  const { getAgentSetting } = await import("@/lib/agentSettings");
  const fallbackOfficeName = await getAgentSetting("office", session?.agentId, "SHAKEEB");

  // خريطة الباقات (السعر لمتغيّر {price}، والاسم لمتغيّر {package})
  const packages = await prisma.package.findMany({ select: { id: true, name: true, priceDinar: true } });
  const priceMap = new Map(packages.map((p) => [p.id, p.priceDinar ?? 0]));
  const pkgNameMap = new Map(packages.map((p) => [p.id, p.name]));

  let sent = 0;
  let failed = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const GAP_MS = 10000; // تأخير 10 ثوانٍ بين رسالة وأخرى (تجنّب الحظر)

  for (let i = 0; i < recipients.length; i++) {
    const sub = recipients[i];
    const office = sub.towerId ? officeMap.get(sub.towerId) : null;

    // تفعيل واتساب المكتب = رسائل المشتركين فقط: إن كان مُطفأً لا تصل أي رسالة لأي مشترك (حتى الفردية)
    if (channel === "WHATSAPP" && office?.waEnabled === "0") continue;
    if (i > 0 && channel === "WHATSAPP") await sleep(GAP_MS);

    // اسم المكتب في القالب = اسم مكتب المشترك (الثوابت تتغيّر حسب المكتب)
    const rendered = renderTemplate(text, {
      name: sub.name,
      netUser: sub.netUser,
      package: sub.packageId ? pkgNameMap.get(sub.packageId) ?? "" : "",
      phone: sub.phone,
      dateTo: sub.dateTo ? formatDate(sub.dateTo) : "",
      carry: sub.carry ?? 0,
      remaining: sub.carry ?? 0,
      price: sub.packageId ? priceMap.get(sub.packageId) ?? 0 : 0,
      code: sub.rewardCode, balance: sub.rewardBalance ?? 0, // كود/رصيد الخصم (فارغ لمن لا رصيد له)
      office: office?.name ?? fallbackOfficeName,
    });
    // الإرسال من جلسة واتساب مكتب المشترك
    const result = await sendViaProvider(channel, sub.phone, rendered, sub.towerId);
    await prisma.message.create({
      data: {
        channel,
        subscriberId: sub.id,
        phone: sub.phone,
        text: rendered,
        status: result.ok ? "SENT" : "FAILED",
        error: result.error ?? null,
        createdByUser: session?.username,
      },
    });
    if (result.ok) sent++;
    else failed++;
  }

  await prisma.auditLog.create({
    data: {
      userId: session?.userId,
      action: "SEND_MESSAGE",
      entity: "message",
      details: `${channel} - ${target} - نجح ${sent} فشل ${failed}`,
    },
  });

  return NextResponse.json({ ok: true, sent, failed, total: recipients.length });
}
