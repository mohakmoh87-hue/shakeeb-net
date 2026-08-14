import { NextResponse } from "next/server";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";
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
  // إرسالٌ صامتٌ في الخلفيّة (طلب محمد 2026-08-09): الردّ يعود فوراً وتُكمل الحلقة مفصولةً،
  // فتُغلق النافذة ويتنقّل المستخدم بحرّيّة بلا انتظار ١٠ ثوانٍ × عدد المشتركين.
  background: z.boolean().default(false),
  // 🖼️ نوعُ القالب الذي اختاره المُرسِل (بلاغ محمد 2026-08-14: «الصورة لا تصل»): هذا المسارُ
  // اليدويُّ كان لا يعرف القالبَ أصلاً فلا يحمل صورتَه — بينما التلقائيّاتُ كلُّها تحملها.
  // بتمريره تُحمَّل صورةُ القالب الفعّالة (بسُلَّم مكتب←وكيل) وتُرسَل تعليقاً مع النصّ.
  templateType: z.string().trim().max(40).optional(),
});

// سجل الرسائل — عزل المستأجر (كان يعرض رسائل كل الوكلاء):
// رسائل مشتركي مكاتب وكيل المستخدم + الرسائل غير المرتبطة بمشترك التي أرسلها مستخدمو وكيله
export async function GET(request: Request) {
  const g = await guard("messaging.manage");
  if (g.error) return g.error;

  const channel = new URL(request.url).searchParams.get("channel");
  const { agentTowerIds } = await import("@/lib/guard");
  const agentId = g.session?.agentId ?? -1;
  const towers = new Set(await agentTowerIds(g.session));

  // ===== عزل الرسائل غير المرتبطة بمشترك (تقارير المدير/المزامنة) — إصلاح تسريبٍ عبر الوكلاء =====
  // كان الترشيح باسم المُنشئ نصّاً (createdByUser ∈ أسماء مستخدمي الوكيل + "scheduler")، فمن
  // يُسمِّي مستخدماً «scheduler» يرى تقارير وكلاء آخرين (هواتف المدراء وأرقامهم الماليّة كاملة).
  // الآن: الرسالة تحمل agentId ⇒ ترشيحٌ صريح. والصفوف القديمة (بلا agentId) تُقبَل فقط إن كان
  // هاتفها أحد هواتف مدراء **مكاتب هذا الوكيل** — لا بالاسم أبداً.
  const legacyPhones = new Set<string>();
  {
    const rows = await prisma.tower.findMany({
      where: { agentId, isDeleted: false, managerPhone: { not: null } },
      select: { managerPhone: true },
    });
    for (const r of rows) if (r.managerPhone) legacyPhones.add(r.managerPhone.trim());
    const us = await prisma.user.findMany({ where: { agentId, managerPhone: { not: null } }, select: { managerPhone: true } });
    for (const u of us) if (u.managerPhone) legacyPhones.add(u.managerPhone.trim());
  }

  // لا علاقة مباشرة بين الرسالة والمشترك في المخطط — نجلب دفعة أكبر ثم نرشّح بمكاتب الوكيل
  const batch = await prisma.message.findMany({
    where: {
      ...(channel ? { channel: channel as Channel } : {}),
      // رسائل هذا الوكيل أو رسائل مشتركين (تُرشَّح بمكتب المشترك أدناه) أو صفوفٌ قديمة بلا وكيل
      OR: [{ agentId }, { agentId: null }, { subscriberId: { not: null } }],
    },
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
      // بلا مشترك: وكيلٌ صريح، أو صفٌّ قديم هاتفه أحد هواتف مدراء هذا الوكيل
      if (m.agentId != null) return m.agentId === agentId;
      return !!m.phone && legacyPhones.has(m.phone.trim());
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
  const { channel, text, target, subscriberId, subscriberIds, expiringDays, from, to, search, background } = parsed.data;

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
    // ب-٨ · حدودُ اليوم بتوقيت بغداد (وبلا `from` يبقى «من البداية»)
    const fromD = baghdadStart(from) ?? new Date(0);
    const toD = baghdadEnd(to) ?? new Date();
    where = { isDeleted: false, ...scope, dateTo: { not: null, gte: fromD, lte: toD } };
  } else if (target === "search") {
    // بحث مخصّص في الاسم/اليوزر/الهاتف + نطاق تاريخ انتهاء اختياري (يُدمجان معاً)
    const q = (search ?? "").trim();
    let dateFilter: Record<string, unknown> = {};
    if (from || to) {
      const range: Record<string, unknown> = { not: null };
      // ب-٨ · حدودُ اليوم بتوقيت بغداد
      { const d = baghdadStart(from); if (d) range.gte = d; }
      { const d = baghdadEnd(to); if (d) range.lte = d; }
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

  // المشترك المُعطَّل (المحذوف) لا يُراسَل — وصولاته باقية لكنه خارج الخدمة
  const recipients = await prisma.subscriber.findMany({ where: { ...where, isDeleted: false } });
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

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const GAP_MS = 10000; // تأخير 10 ثوانٍ بين رسالة وأخرى (تجنّب الحظر)

  // 🖼️ صورةُ القالب المختار لكلّ مكتبٍ (سُلَّم مكتب←وكيل) — تُحمَّل كسولاً وتُخزَّن لكلّ مكتب،
  // فمئةُ مستلمٍ من مكتبٍ واحدٍ = قراءةٌ واحدة. وبلا قالبٍ مختارٍ لا صورةَ (السلوك القديم).
  const templateType = (parsed.data.templateType ?? "").trim() || null;
  const tplImageCache = new Map<number, string | null>();
  async function imageFor(towerId: number | null): Promise<string | null> {
    if (!templateType || towerId == null) return null;
    if (tplImageCache.has(towerId)) return tplImageCache.get(towerId)!;
    let img: string | null = null;
    try {
      const { getEffectiveTemplateFull } = await import("@/lib/smsTemplates");
      img = (await getEffectiveTemplateFull(templateType, session?.agentId ?? null, towerId))?.image ?? null;
    } catch { img = null; }
    tplImageCache.set(towerId, img);
    return img;
  }

  // ===== حلقة الإرسال — قابلةٌ للتشغيل في الخلفيّة (طلب محمد 2026-08-09) =====
  // بفاصل ١٠ ثوانٍ بين رسالة وأخرى، إرسالُ ١٠٠ مشتركٍ يستغرق ~١٧ دقيقة. كان الطلب يبقى
  // معلّقاً كلّ هذه المدّة فتُحتجَز الواجهة (ويقطعه انتهاء مهلة البوّابة). صار الإرسال الجماعيّ
  // يعمل **مفصولاً**: النافذة تُغلق فوراً ويتنقّل المستخدم بحرّيّة، والرسائل تُسجَّل في سجلّ
  // الرسائل واحدةً واحدةً كما تُرسَل.
  async function runSend(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
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
      address: sub.address, // «ادرس 1» من الساس — يظهر فقط إن أدخله المدير في القالب
      package: sub.packageId ? pkgNameMap.get(sub.packageId) ?? "" : "",
      phone: sub.phone,
      dateTo: sub.dateTo ? formatDate(sub.dateTo) : "",
      carry: sub.carry ?? 0,
      remaining: sub.carry ?? 0,
      price: sub.packageId ? priceMap.get(sub.packageId) ?? 0 : 0,
      code: sub.rewardCode, balance: sub.rewardBalance ?? 0, // كود/رصيد الخصم (فارغ لمن لا رصيد له)
      office: office?.name ?? fallbackOfficeName,
    });
    // الإرسال من جلسة واتساب مكتب المشترك — ومعه صورةُ القالب المختار إن وُجدت
    const result = await sendViaProvider(channel, sub.phone, rendered, sub.towerId, await imageFor(sub.towerId));
    await prisma.message.create({
      data: {
        channel,
        subscriberId: sub.id,
        phone: sub.phone,
        text: rendered,
        status: result.ok ? "SENT" : "FAILED",
        error: result.error ?? null,
        createdByUser: session?.username,
        agentId: session?.agentId ?? null, // عزل سجلّ الرسائل بالوكيل
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
    return { sent, failed };
  }

  // ═════ ب-٢ · البثُّ الجماعيُّ واتساب يصطفّ في القاعدة — لا حلقةَ ذاكرةٍ تموت ═════
  // (بثُّ الشدن مات عند ٤١٦/٢٤٤٧ لأنّ الحلقة كانت مفصولةً في ذاكرة الحاوية — وأيُّ نشرةٍ
  //  تقتلها صامتاً بلا أثرٍ للبقيّة.) الآن: **كلُّ** المستلمين يُكتبون صفوفاً `PENDING`
  //  دفعةً أوّلاً، والساحبُ (`broadcastQueue`) يجرّها بفاصل الحظر نفسِه ويُستأنف عند
  //  الإقلاع — فالمتبقّي محفوظٌ في القاعدة مهما حدث. والفرديُّ يبقى فوريّاً كما كان
  //  (المستخدمُ ينتظر نتيجتَه أمامه).
  // ⏳ صورةُ القالب في البثّ المصطفّ مؤجَّلة: صفُّ `messages` لا يحمل نوعَ القالب والساحبُ
  // في lib — فإضافتُها تحتاج عموداً وقراءتَه في الساحب (دفعةُ هدمٍ قادمة). البثُّ نصٌّ الآن.
  if (channel === "WHATSAPP" && target !== "one" && recipients.length > 1) {
    const rows = recipients
      .filter((sub) => !(officeMap.get(sub.towerId ?? -1)?.waEnabled === "0")) // مكتبٌ مُطفأُ الواتساب لا يُصطَفّ (سلوكُ الحلقة القديمة نفسُه)
      .map((sub) => {
        const office = sub.towerId ? officeMap.get(sub.towerId) : null;
        return {
          channel, subscriberId: sub.id, phone: sub.phone,
          text: renderTemplate(text, {
            name: sub.name, netUser: sub.netUser, address: sub.address,
            package: sub.packageId ? pkgNameMap.get(sub.packageId) ?? "" : "",
            phone: sub.phone, dateTo: sub.dateTo ? formatDate(sub.dateTo) : "",
            carry: sub.carry ?? 0, remaining: sub.carry ?? 0,
            price: sub.packageId ? priceMap.get(sub.packageId) ?? 0 : 0,
            code: sub.rewardCode, balance: sub.rewardBalance ?? 0,
            office: office?.name ?? fallbackOfficeName,
          }),
          status: "PENDING" as const,
          createdByUser: session?.username, agentId: session?.agentId ?? null,
        };
      });
    if (!rows.length) return NextResponse.json({ error: "لا يوجد مستلمون مطابقون (واتساب مكاتبهم مُطفأ)" }, { status: 400 });
    await prisma.message.createMany({ data: rows });
    await prisma.auditLog.create({
      data: {
        userId: session?.userId, action: "SEND_MESSAGE", entity: "message",
        details: `${channel} - ${target} - اصطفّ ${rows.length} في طابور البثّ (يُستأنف تلقائيّاً)`,
      },
    }).catch(() => {});
    const { kickBroadcastDrainer } = await import("@/lib/broadcastQueue");
    kickBroadcastDrainer("بثّ جديد");
    // نفسُ عقد الردّ الخلفيّ القائم — فلا تتغيّر أيُّ واجهةٍ تنادي هذا المسار
    return NextResponse.json({ ok: true, background: true, queued: rows.length, total: rows.length });
  }

  // إرسالٌ صامتٌ في الخلفيّة: نُعيد الردّ فوراً ونُكمل الحلقة مفصولةً عن الطلب
  if (background) {
    void runSend().catch((e) => console.error("[messages] background send:", e instanceof Error ? e.message : e));
    return NextResponse.json({ ok: true, background: true, total: recipients.length });
  }
  const { sent, failed } = await runSend();

  return NextResponse.json({ ok: true, sent, failed, total: recipients.length });
}
