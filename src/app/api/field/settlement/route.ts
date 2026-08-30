import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isFieldManager } from "@/lib/field";
import { agentTowerIds, agentOfficeFilter } from "@/lib/guard";

export const dynamic = "force-dynamic";

// تحصيل الفنيين: لكل فني مجموع مبالغ تكتاته المنجزة غير المحصّلة (معلّقة).
// مستخدم المكتب يرى فنيّي مكتبه؛ المدير يرى كل المكاتب.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const manager = isFieldManager(session);
  const agentTowers = await agentTowerIds(session);

  const techWhere = manager
    ? { isDeleted: false, OR: [{ towerId: { in: agentTowers } }, { supportTowerId: { in: agentTowers } }] }
    : { isDeleted: false, OR: [{ towerId: session.towerId ?? null }, { supportTowerId: session.towerId ?? null }] };
  const technicians = await prisma.technician.findMany({
    where: techWhere,
    select: { id: true, name: true, towerId: true },
    orderBy: { id: "asc" },
  });
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false, ...(await agentOfficeFilter(session)) }, select: { id: true, name: true }, orderBy: { id: "asc" },
  });

  // البطاقات المنجزة غير المحصّلة — محصورة بلوحات مكاتب المُشاهد (المدير: مكاتب وكيله؛
  // الموظف: مكتبه فقط) — فبطاقات الفني المُعار «دعماً» في مكتبي تظهر لي، وبطاقات
  // مكتبه الأصلي لا تظهر (كلٌّ يحصّل بطاقات مكتبه فقط)
  const viewTowers = manager ? agentTowers : [session.towerId ?? -1];
  const viewBoards = await prisma.taskBoard.findMany({ where: { towerId: { in: viewTowers }, isDeleted: false }, select: { id: true } });
  const viewLists = await prisma.taskList.findMany({ where: { boardId: { in: viewBoards.map((b) => b.id) } }, select: { id: true } });
  // أنواع التوصيل لدى الوكيل: مبلغها المقبوض يُخزَّن في amount عند الإنجاز لكنه
  // «اشتراك» بالمعنى المحاسبي — يُعاد تصنيفه أدناه (كان يظهر معكوساً: مبيع 36 واشتراك 0)
  const deliveryKinds = new Set(
    (await prisma.cardType.findMany({
      where: { isDeleted: false, deliveryOnly: true, agentId: session.agentId ?? -1 },
      select: { name: true },
    })).map((x) => x.name),
  );
  const isDeliveryKind = (k: string) => deliveryKinds.has(k) || k === "توصيل";

  const cards = await prisma.taskCard.findMany({
    where: { done: true, settled: false, isDeleted: false, technicianId: { in: technicians.map((t) => t.id) }, listId: { in: viewLists.map((l) => l.id) } },
    select: { id: true, title: true, kind: true, amount: true, subAmount: true, technicianId: true, description: true, subscriberId: true },
    orderBy: { id: "asc" },
  });
  type SItem = { title: string; kind: string; amount: number; subAmount: number; netUser: string | null; subscriberId: number | null; isDelivery: boolean };
  const byTech = new Map<number, SItem[]>();
  for (const c of cards) {
    if (c.technicianId == null) continue;
    // اليوزر مخزّن في وصف البطاقة كسطر «👤 اليوزر: X»
    const netUser = c.description?.match(/اليوزر\s*[:：]\s*([^\n]+)/)?.[1]?.trim();
    const arr = byTech.get(c.technicianId) ?? [];
    arr.push({ title: c.title, kind: c.kind, amount: c.amount ?? 0, subAmount: c.subAmount ?? 0, netUser: netUser && netUser !== "—" ? netUser : null, subscriberId: c.subscriberId ?? null, isDelivery: isDeliveryKind(c.kind) });
    byTech.set(c.technicianId, arr);
  }
  // مُفعَّل = للمشترك تفعيلٌ حقيقيٌّ (moneyType:1، لا دينٌ سابق) ضمن ٧ أيّام سابقة حتى الآن (قرار محمد)
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const delSubIds = [...new Set(cards.filter((c) => isDeliveryKind(c.kind) && c.subscriberId != null).map((c) => c.subscriberId as number))];
  const activatedSet = new Set<number>();
  if (delSubIds.length) {
    const acts = await prisma.subscriptionEntry.findMany({
      where: { subscriberId: { in: delSubIds }, isDeleted: false, moneyType: 1, date: { gte: since } },
      select: { subscriberId: true },
    });
    for (const a of acts) if (a.subscriberId != null) activatedSet.add(a.subscriberId);
  }
  // بطاقات التوصيل: مبلغها (المخزَّن في amount عند الإنجاز) اشتراكٌ محاسبياً —
  // يُنقل لخانة الاشتراك فيصحّ العرض والمجاميع (كان يظهر «مبيع 36 واشتراك 0» معكوساً)
  for (const [k, arr] of byTech) {
    byTech.set(k, arr.map((x) => (isDeliveryKind(x.kind)
      ? { ...x, amount: 0, subAmount: x.subAmount + x.amount }
      : x)));
  }

  return NextResponse.json({
    isManager: manager,
    offices,
    technicians: technicians.map((t) => {
      const items = byTech.get(t.id) ?? [];
      // المجموع الكلي المستلم من الفني = «المبيع» + «اشتراك» (مبلغ التوصيل صُنّف اشتراكاً أعلاه)
      const saleTotal = items.reduce((s, x) => s + x.amount, 0);
      const subTotal = items.reduce((s, x) => s + x.subAmount, 0);
      return {
        id: t.id, name: t.name, towerId: t.towerId,
        pendingTotal: saleTotal + subTotal,
        saleTotal, subTotal,
        pendingCount: items.length,
        items: items.map((x) => ({ ...x, activated: x.subscriberId != null && activatedSet.has(x.subscriberId) })),
      };
    }),
  });
}

// اكمال: تحصيل تكتات فني (تُعلَّم محصّلة وتُزال من اللوحة، وتُحذف صورها فعلياً).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  const technicianId = Number(b?.technicianId);
  if (!technicianId) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });

  // عزل المستأجر: مستخدم المكتب يحصّل فنيّي مكتبه (ومنهم المُعار «دعماً» لمكتبه —
  // يتصرّف كفنيٍّ تابع له طوال الدعم)؛ المدير فنيّي وكيله فقط
  const tech = await prisma.technician.findUnique({ where: { id: technicianId } });
  if (!tech) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  const myOffice = session.towerId ?? null;
  if (isFieldManager(session)) {
    const agentTowers = await agentTowerIds(session);
    const ok = (tech.towerId != null && agentTowers.includes(tech.towerId)) || (tech.supportTowerId != null && agentTowers.includes(tech.supportTowerId));
    if (!ok) return NextResponse.json({ error: "لا يمكنك تحصيل فني وكيل آخر" }, { status: 403 });
  } else if (tech.towerId !== myOffice && tech.supportTowerId !== myOffice) {
    return NextResponse.json({ error: "لا يمكنك تحصيل فني مكتب آخر" }, { status: 403 });
  }

  // التحصيل محصور ببطاقات لوحات مكاتب المُحصِّل (المدير: مكاتب وكيله؛ الموظف: مكتبه) —
  // فتحصيلي لفنيٍّ مُعار لي لا يلمس بطاقات مكتبه الأصلي غير المحصّلة
  const settleTowers = isFieldManager(session) ? await agentTowerIds(session) : [myOffice ?? -1];
  const settleBoards = await prisma.taskBoard.findMany({ where: { towerId: { in: settleTowers }, isDeleted: false }, select: { id: true } });
  const settleLists = await prisma.taskList.findMany({ where: { boardId: { in: settleBoards.map((b) => b.id) } }, select: { id: true } });
  const cards = await prisma.taskCard.findMany({
    where: { technicianId, done: true, settled: false, isDeleted: false, listId: { in: settleLists.map((l) => l.id) } },
    select: { id: true, amount: true, subAmount: true },
  });
  const ids = cards.map((c) => c.id);
  let settlementId: number | null = null;
  // المجموع المحصَّل من الفني = المبيع + الاشتراك (وللتوصيل مبلغه)
  const total = cards.reduce((s, c) => s + (c.amount ?? 0) + (c.subAmount ?? 0), 0);

  if (ids.length > 0) {
    // أرشفة بدل الحذف: تبقى البطاقة بالأرشيف أسبوعاً ثم تُحذف نهائياً (أو يحذفها المدير يدوياً).
    // صور العمل تبقى مع البطاقة لعرضها من الأرشيف — وتُحذف معها بالتنظيف الأسبوعي/الحذف اليدوي.
    await prisma.taskCard.updateMany({ where: { id: { in: ids } }, data: { settled: true, archivedAt: new Date() } });
    const byName = session.fullName ?? session.username;
    const { appendCardHistory } = await import("@/lib/field");
    await Promise.all(ids.map((id) => appendCardHistory(id, byName, "تحصيل وأرشفة البطاقة")));

    // قيد تحصيل دائم (المرحلة ٨): كان التحصيل يعلّم البطاقات محصَّلة بلا أي أثر —
    // لا قيد ولا تراجع — والبطاقات تُحذف بعد أسبوع فيضيع أصل الرقم نهائياً.
    // لا يُنشأ قيد مالي هنا عمداً: مالُ «المبيع» سُجّل فاتورةً لحظة إنجاز البطاقة،
    // فإنشاء حركة ثانية هنا يعني احتساب المبلغ مرتين. الأثر المطلوب هو سجلّ يوثّق
    // ويسمح بالتراجع — وهذا ما يفعله هذا القيد.
    settlementId = (await prisma.auditLog.create({
      data: {
        userId: session.userId,
        action: "SETTLE_TECH",
        entity: "technician",
        entityId: String(technicianId),
        details: JSON.stringify({
          tech: tech.name, by: byName, count: ids.length, total,
          sale: cards.reduce((s2, c) => s2 + (c.amount ?? 0), 0),
          sub: cards.reduce((s2, c) => s2 + (c.subAmount ?? 0), 0),
          cardIds: ids,
        }),
      },
      select: { id: true },
    })).id;
  }

  // ===== «اكمال» هو الذي يُنهي دعم البطاقات ويُرحّل الذمّة (قرار محمد 2026-08-09) =====
  // إن صارت كلّ بطاقات دعمه منجزةً **ومحصَّلة** ⇒ ينتهي دعمه، وما بقي بذمّته من موادّ مكتب الدعم
  // يُرحَّل إلى مخزن مكتبه ويبقى بذمّته (ينقص هناك ويزيد هنا، ويُدمَج مع ذمّةٍ قائمة لنفس المادّة).
  let supportEnded = false;
  try {
    const { maybeEndCardSupport } = await import("@/lib/field");
    const r = await maybeEndCardSupport(technicianId);
    supportEnded = r.ended;
    if (r.ended) {
      const { notify } = await import("@/lib/notify");
      void notify({
        agentId: tech.agentId, towerId: tech.towerId, type: "checkout",
        title: "انتهاء الدعم", body: `${tech.name} أُكملت بطاقات دعمه — عاد لمكتبه ورُحّلت ذممه إلى مخزنه`,
        refType: "technician", refId: technicianId,
      });
    }
  } catch { /* لا يُفشل التحصيل */ }

  return NextResponse.json({ ok: true, settledCount: ids.length, total, settlementId, supportEnded });
}
