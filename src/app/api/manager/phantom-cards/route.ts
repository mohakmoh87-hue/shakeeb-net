import { NextResponse } from "next/server";
import { requireOwnerForBulk } from "@/lib/bulkDeleteGate";
import { captureCardsBeforeDelete, inspectPendingDeletedCards, GUARD_INLINE_MAX } from "@/lib/cardDeleteGuard";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// لوحة «الكروت الوهمية» في حسابات المدير: كروت عُلِّمت مستخدمة في البرنامج بلا تفعيل مقابل في
// SAS (سجّلتها المزامنة بـ action=SYNC_PHANTOM_VERIFIED بعد تحقّق مباشر بالبحث — لا نقرأ
// SYNC_PHANTOM_CARD القديم الذي كتبه منطق سابق بلا تحقّق فقد يحوي إيجابيات كاذبة). «المعلَّق» =
// الكارت ما زال مستخدماً وموجوداً ويتبع وكيل المستخدم — فيسقط تلقائياً بعد الإرجاع (useDate=null)
// أو الحذف (اختفاء الصف). الإجراءات لا تمسّ الوصل ولا المال إطلاقاً (قرار المستخدم).
const PHANTOM_ACTION = "SYNC_PHANTOM_VERIFIED";

// GET — قائمة الكروت الوهمية المعلَّقة لوكيل المستخدم (مع اسم المشترك والمكتب ومبلغ الوصل للاطلاع)
export async function GET() {
  const g = await guard("cards.delete");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;

  // آخر 120 يوماً من تنبيهات الوهمي — أحدث تاريخ اكتشاف لكل كارت
  const since = new Date(Date.now() - 120 * 86400 * 1000);
  const audits = await prisma.auditLog.findMany({
    where: { action: PHANTOM_ACTION, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, createdAt: true },
  });
  const detectedAt = new Map<number, Date>();
  for (const a of audits) {
    const id = Number(a.entityId);
    if (Number.isFinite(id) && !detectedAt.has(id)) detectedAt.set(id, a.createdAt);
  }
  const ids = [...detectedAt.keys()];
  if (ids.length === 0) return NextResponse.json({ cards: [] });

  // ===== كارتٌ رُبِط بمشتركه الحقيقيّ يسقط من القائمة (بلاغ محمد 2026-08-10) =====
  // الربط يعني أنّ SAS **أثبت** أنّ السيريال مُستعمَلٌ فعلاً ⇒ الكارت ليس وهميّاً.
  // كان يبقى معلّقاً لأنّ الربط لا يُغيّر useDate (والترشيح أدناه يعتمد useDate وحده)،
  // فيرى المدير كارتاً حُلَّت مشكلته وكأنّه ما زال وهميّاً.
  const links = await prisma.auditLog.findMany({
    where: { action: "PHANTOM_CARD_LINK", createdAt: { gte: since } },
    select: { entityId: true, createdAt: true },
  });
  const linkedAt = new Map<number, Date>();
  for (const l of links) {
    const id = Number(l.entityId);
    if (!Number.isFinite(id)) continue;
    const prev = linkedAt.get(id);
    if (!prev || l.createdAt.getTime() > prev.getTime()) linkedAt.set(id, l.createdAt);
  }

  // المعلَّق فقط: الكارت موجود، يتبع الوكيل، وما زال مستخدماً (لم يُرجَع/يُحذف)
  const cards = (await prisma.rechargeCard.findMany({
    where: { id: { in: ids }, agentId, useDate: { not: null } },
    select: { id: true, serial: true, useDate: true, subscriberId: true, price: true },
  }))
    // الوسم يخصّ **استعمالاً بعينه**: إن أُرجع الكارت بعد الاكتشاف ثم استُعمل من
    // جديد (لمشترك آخر فُعِّل فعلاً في SAS) فالوسم القديم لا يخصّ هذا الاستعمال —
    // وكان يبقى معلّقاً فيظهر كارتٌ سليم في قائمة الوهمية.
    // (حادثة 422710444410792: وُسِم 30 تموز 09:16 على استعمال المواصلات، ثم
    //  استعملته الشهداء 18:09 لمشترك فُعِّل في SAS — فبقي الوسم بلا سبب.)
    .filter((c) => {
      const at = detectedAt.get(c.id);
      // رُبِط بعد الاكتشاف ⇒ ثبت أنّه مُستعمَلٌ حقيقةً فلا يُعرَض
      const lk = linkedAt.get(c.id);
      if (lk && (!at || lk.getTime() >= at.getTime())) return false;
      return !at || !c.useDate || c.useDate.getTime() <= at.getTime();
    });

  // اسم المشترك ومكتبه
  const subIds = [...new Set(cards.map((c) => c.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true, towerId: true } })
    : [];
  const subById = new Map(subs.map((s) => [s.id, s]));
  const towerIds = [...new Set(subs.map((s) => s.towerId).filter((x): x is number => x != null))];
  const towers = towerIds.length
    ? await prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } })
    : [];
  const towerName = new Map(towers.map((t) => [t.id, t.name]));

  // مبلغ آخر وصل تفعيل بنفس السيريال (للاطلاع فقط — لا يُلمَس)
  const serials = cards.map((c) => (c.serial ?? "").trim()).filter(Boolean);
  const entries = serials.length
    ? await prisma.subscriptionEntry.findMany({
        where: { card2: { in: serials }, isDeleted: false },
        orderBy: { date: "desc" },
        select: { card2: true, money: true },
      })
    : [];
  const amountBySerial = new Map<string, number | null>();
  for (const e of entries) {
    const s = (e.card2 ?? "").trim();
    if (s && !amountBySerial.has(s)) amountBySerial.set(s, e.money ?? null);
  }

  const list = cards.map((c) => {
    const sub = c.subscriberId != null ? subById.get(c.subscriberId) : null;
    return {
      cardId: c.id,
      serial: c.serial,
      subscriber: sub?.name ?? sub?.netUser ?? null,
      office: sub?.towerId != null ? (towerName.get(sub.towerId) ?? null) : null,
      useDate: c.useDate,
      amount: amountBySerial.get((c.serial ?? "").trim()) ?? null,
      // كلفة شراء الكارت — تنقص من «ديون الكارتات» عند الحذف النهائي (لا عند الإرجاع).
      // منفصلة عن amount (مبلغ وصل الاشتراك) — خلطهما يضلّل المدير.
      cardPrice: c.price ?? 0,
      detectedAt: detectedAt.get(c.id) ?? null,
    };
  });
  list.sort((a, b) => (b.detectedAt?.getTime() ?? 0) - (a.detectedAt?.getTime() ?? 0));
  return NextResponse.json({ cards: list });
}

const actionSchema = z.object({
  action: z.enum(["return", "delete", "link"]),
  cardIds: z.array(z.coerce.number()).min(1, "لم تُحدَّد كروت"),
});

// POST — إجراء المدير على كروت وهمية محدّدة: إرجاع للمخزن أو حذف نهائي (بعزل agentId).
// لا يمسّ الوصل ولا المال — تحرير/حذف الكارت فقط.
export async function POST(request: Request) {
  const g = await guard("cards.delete");
  if (g.error) return g.error;
  const session = await getSession();
  const agentId = g.session?.agentId ?? -1;

  const body = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const { action, cardIds } = parsed.data;

  // ===== ربط الكارت بمشتركه الحقيقي (طلب محمد 2026-08-05) =====
  // بدل «أرجعه أو احذفه» فقط: نسأل SAS مَن استعمل هذا السيريال فعلاً.
  // إن وُجد ⇒ يُربط الكارت بذلك المشترك ويسقط الوسم. وإن لم يوجد ⇒ يُقال صراحةً
  // إن الكارت غير مستخدم، فتقرر إرجاعه للمخزن بنفسك.
  if (action === "link") {
    const { sasBaseUrl, sasLogin, sasSearchActivation } = await import("@/lib/sas4");
    const cards = await prisma.rechargeCard.findMany({
      where: { id: { in: cardIds }, agentId },
      select: { id: true, serial: true, subscriberId: true },
    });
    if (!cards.length) return NextResponse.json({ error: "لا كارت مطابق ضمن حسابك" }, { status: 404 });

    // مكاتب الوكيل المرتبطة بـSAS — نبحث في كلٍّ منها حتى نجد السيريال
    const towers = await prisma.tower.findMany({
      where: { agentId, isDeleted: false, loginUrl: { not: null }, username: { not: null }, password: { not: null } },
      select: { id: true, name: true, loginUrl: true, username: true, password: true },
    });
    if (!towers.length) return NextResponse.json({ error: "لا مكتب مربوط بـSAS" }, { status: 400 });

    const results: { cardId: number; serial: string | null; status: string; subscriber?: string; office?: string }[] = [];
    for (const c of cards) {
      const serial = (c.serial ?? "").trim();
      if (!serial) { results.push({ cardId: c.id, serial: c.serial, status: "no-serial" }); continue; }
      let found: { username: string | null; name: string | null } | null = null;
      let office: string | null = null;
      let reachable = false;
      for (const t of towers) {
        try {
          const base = sasBaseUrl(t.loginUrl!);
          const token = await sasLogin(base, t.username!, t.password!);
          reachable = true;
          const hit = await sasSearchActivation(base, token, serial);
          if (hit) { found = { username: hit.username, name: hit.name }; office = t.name; break; }
        } catch { /* مكتب متعذّر — نجرّب التالي */ }
      }
      if (!reachable) { results.push({ cardId: c.id, serial: c.serial, status: "sas-unreachable" }); continue; }
      if (!found) { results.push({ cardId: c.id, serial: c.serial, status: "not-used" }); continue; }

      // مطابقة صاحب التفعيل بمشترك في البرنامج (باليوزر) — ضمن مكاتب الوكيل
      const uname = (found.username ?? "").trim();
      const sub = uname
        ? await prisma.subscriber.findFirst({
            where: { netUser: uname, isDeleted: false, towerId: { in: towers.map((t) => t.id) } },
            select: { id: true, name: true, netUser: true },
          })
        : null;
      if (!sub) {
        results.push({ cardId: c.id, serial: c.serial, status: "sas-user-not-in-app", subscriber: found.name ?? uname, office: office ?? undefined });
        continue;
      }
      await prisma.rechargeCard.update({
        where: { id: c.id },
        data: { subscriberId: sub.id, userName: sub.netUser ?? sub.name },
      });
      await prisma.auditLog.create({
        data: {
          userId: session?.userId, action: "PHANTOM_CARD_LINK", entity: "rechargeCard", entityId: String(c.id),
          details: "ربط كارت " + serial + " بمشتركه الحقيقي حسب SAS: " + (sub.name ?? sub.netUser) + " — بلا مساس بالوصل ولا المال",
        },
      });
      results.push({ cardId: c.id, serial: c.serial, status: "linked", subscriber: sub.name ?? sub.netUser ?? undefined, office: office ?? undefined });
    }
    return NextResponse.json({ ok: true, results });
  }

  if (action === "return") {
    // إرجاع للمخزن: تحرير الكارت فقط (يعود متاحاً) — دون لمس الوصل/المال/الأيام
    const res = await prisma.rechargeCard.updateMany({
      where: { id: { in: cardIds }, agentId },
      data: { useDate: null, subscriberId: null, userName: null, reservedBy: null, reservedAt: null },
    });
    await prisma.auditLog.create({
      data: {
        userId: session?.userId, action: "PHANTOM_CARD_RETURN", entity: "rechargeCard",
        entityId: cardIds.join(","), details: `إرجاع ${res.count} كارت وهمي للمخزن (تحرير الكارت فقط — بلا مساس بالوصل/المال)`,
      },
    });
    return NextResponse.json({ ok: true, affected: res.count });
  }

  // ===== حذف نهائي من المخزن — **بلا أن تنقص «ديون الكارتات»** (طلب محمد 2026-08-10) =====
  // الديون = مجموع أسعار كروت الوكيل + التعديلات اليدوية، فحذف الصفّ كان يُخرج سعره من
  // المجموع فتنزل الديون وحدها (حُذف ٢٦٦ كارتاً يوم 2026-07-27 فنزلت ملايين بلا أن يعرف أحد،
  // و٣ كروت يوم 2026-08-10 فنقص ١٠٣٥٠٠).
  // والصحيح اقتصاديّاً: الكارت الوهميّ **مُشترى فعلاً** من الموزّع فالدين قائمٌ عليه، وكونه
  // بلا تفعيل في SAS لا يُلغي ثمنه. فنُسجّل حركةً معاوِضة بقيمة المحذوف فيبقى الدين كما هو،
  // وتظهر الحركة في سجلّ حسابات المدير موضَّحةً (قابلةٌ للحذف إن أراد المدير إنقاصه فعلاً).
  const delWhere = { id: { in: cardIds }, agentId };
  const agg = await prisma.rechargeCard.aggregate({ where: delWhere, _sum: { price: true } });
  const removedDebt = agg._sum.price ?? 0;
  // 🛡️ حارسُ المال · **لقطةٌ قبل الحذف — لا مرورَ لكارتٍ بلا فحص** (طلبُ محمد 2026-08-14)
  //   وهذا المسارُ بعينه هو الذي حذف ٧٤ كارتاً حقيقيّاً (٩ آب) وتعذّر إثباتُها لأنّ
  //   السجلَّ كتب المُعرِّفات لا السيريالات. فاللقطةُ تحفظ الصفَّ كاملاً، والفحصُ الصامتُ
  //   في الساس يجري دوريّاً ويُبلّغ عن كلّ حالةٍ غيرِ طبيعيّة.
  // 🛡️ و-٤ · وهذا **مسارُ الحادثة نفسِه**: ٤٣٤ كارتاً في ضغطةٍ واحدةٍ يومَ ٩ آب،
  //   منها ٧٤ مبيعاً ومقبوضَ الثمن. فلا يمرّ فوقَ الحدّ إلّا بكلمةِ مرور المالك.
  {
    const gate = await requireOwnerForBulk({
      count: cardIds.length, userId: g.session?.userId,
      ownerPassword: (body as { ownerPassword?: unknown } | null)?.ownerPassword,
      what: "حذفٌ من الكروت الوهمية",
    });
    if (gate) return gate;
  }
  const captured = await captureCardsBeforeDelete(cardIds, agentId, g.session.fullName ?? g.session.username, "phantom");
  const res = await prisma.rechargeCard.deleteMany({ where: delWhere });
  let keptDebt = 0;
  if (res.count > 0 && removedDebt > 0) {
    await prisma.managerTx.create({
      data: {
        type: "card-debt-add",
        amount: removedDebt,
        notes: `تعويض حذف ${res.count} كارت وهمي — الدين لا ينقص بالحذف (الكروت مُشتراة من الموزّع)`,
        userId: session?.userId,
        agentId,
        byUser: g.session.fullName ?? g.session.username,
      },
    });
    keptDebt = removedDebt;
  }
  await prisma.auditLog.create({
    data: {
      userId: session?.userId, action: "PHANTOM_CARD_DELETE", entity: "rechargeCard",
      entityId: cardIds.join(","),
      details: `حذف ${res.count} كارت وهمي نهائياً من المخزن — ديون الكارتات **لم تنقص** (حركة معاوِضة ${keptDebt.toLocaleString("en-US")} د.ع)، وبلا مساس بالوصل ولا التقرير اليومي`,
    },
  });
  // ⚡ **يتصرّف الحارسُ فورَ الحذف** (طلبُ محمد 2026-08-14): حذفُ كارتٍ أو خمسة يُفحَص **قبل الردّ**
  //   فيصل الإشعارُ في ثوانٍ. وما فوق GUARD_INLINE_MAX يُفحَص بالخلفيّة ثمّ بالمسح الدوريّ
  //   — فبحثُ الساس ~١.٥ث للكارت، وحبسُ المستخدم دقائقَ ليس فحصاً صامتاً.
  if (captured > 0 && captured <= GUARD_INLINE_MAX) {
    await inspectPendingDeletedCards(captured).catch(() => {});
  } else if (captured > 0) {
    void inspectPendingDeletedCards(Math.min(captured, 200)).catch(() => {});
  }
  return NextResponse.json({ ok: true, affected: res.count, removedDebt: 0, keptDebt });
}
