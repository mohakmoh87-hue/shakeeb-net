import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { can } from "@/lib/rbac";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";
import { baghdadDayKey } from "@/lib/attendance";

export const dynamic = "force-dynamic";

// ===== قائمة «المفعّلون» في صفحة كلّ المشتركين (طلب محمد 2026-09-23) =====
// سطرٌ لكلّ تفعيل بين تاريخين (لا سطرٌ لكلّ مشترك) مع عدّاد تكراره في المدّة — كُشف به
// تفعيلٌ مكرّرٌ في مكتب الشهداء أحدث نقصاً ٣٥ ألفاً.
// العزل: مستخدم المكتب ⇒ مكتبه حصراً · المدير ⇒ مكاتب وكيله (كلّ officeId مُصادَق).
// المبالغ لا تُرسَل إلّا لمن يملك مشاهدة الحسابات أو التقارير (قرار محمد: لا تُظهرها للكلّ).
export async function GET(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const session = g.session!;

  const sp = new URL(request.url).searchParams;
  const officeParam = sp.get("office") ?? "all";
  const today = baghdadDayKey(new Date());
  const fromDay = sp.get("from") || today;
  const toDay = sp.get("to") || fromDay;
  const q = (sp.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 2000, 1), 5000);

  const agentTowers = await agentTowerIds(session);
  const isOfficeUser = !session.isAdmin && session.towerId != null;
  let towerIds: number[];
  if (isOfficeUser) {
    towerIds = [session.towerId!];
  } else if (officeParam !== "all") {
    const t = Number(officeParam) || -1;
    towerIds = agentTowers.includes(t) ? [t] : [-1];
  } else {
    towerIds = agentTowers.length ? agentTowers : [-1];
  }

  const start = baghdadStart(fromDay);
  const end = baghdadEnd(toDay);
  if (!start || !end || end < start) {
    return NextResponse.json({ error: "مدى تاريخٍ غير صالح" }, { status: 400 });
  }

  // البحث بالاسم/اليوزر يمرّ بالمشتركين أوّلاً (الوصل لا يحمل اسماً)، والرقم يطابق رقم الوصل
  let qWhere: Record<string, unknown> = {};
  if (q) {
    const matched = await prisma.subscriber.findMany({
      where: {
        towerId: { in: towerIds },
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { netUser: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
        ],
      },
      select: { id: true },
      take: 5000,
    });
    const ids = matched.map((m) => m.id);
    const asNumber = Number(q);
    qWhere = {
      OR: [
        { subscriberId: { in: ids.length ? ids : [-1] } },
        ...(Number.isInteger(asNumber) && asNumber > 0 ? [{ id: asNumber }] : []),
      ],
    };
  }

  const entries = await prisma.subscriptionEntry.findMany({
    where: { isDeleted: false, towerId: { in: towerIds }, date: { gte: start, lte: end }, ...qWhere },
    orderBy: { id: "desc" },
    take: limit,
    select: {
      id: true, date: true, money: true, moneyIn: true, moneyCarry: true, addPrice: true,
      cardType: true, operation: true, isMaster: true, createdByUser: true,
      subscriberId: true, towerId: true,
    },
  });

  const subIds = [...new Set(entries.map((e) => e.subscriberId).filter((x): x is number => x != null))];
  const [subs, towers] = await Promise.all([
    prisma.subscriber.findMany({ where: { id: { in: subIds.length ? subIds : [-1] } }, select: { id: true, name: true, netUser: true, phone: true } }),
    prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } }),
  ]);
  const subById = new Map(subs.map((s) => [s.id, s]));
  const officeName = new Map(towers.map((t) => [t.id, t.name]));

  // عدّادُ التكرار: كم مرّةً فُعِّل هذا المشترك داخل المدّة المعروضة
  const times = new Map<number, number>();
  for (const e of entries) if (e.subscriberId != null) times.set(e.subscriberId, (times.get(e.subscriberId) ?? 0) + 1);

  const showMoney = can(session, "finance.view") || can(session, "reports.view");
  const rows = entries.map((e) => {
    const s = e.subscriberId != null ? subById.get(e.subscriberId) : null;
    return {
      id: e.id,
      date: e.date,
      subscriberId: e.subscriberId,
      name: s?.name ?? null,
      netUser: s?.netUser ?? null,
      phone: s?.phone ?? null,
      office: e.towerId != null ? officeName.get(e.towerId) ?? null : null,
      towerId: e.towerId,
      package: e.cardType ?? e.operation ?? null,
      isMaster: !!e.isMaster,
      by: e.createdByUser ?? null,
      times: e.subscriberId != null ? times.get(e.subscriberId) ?? 1 : 1,
      ...(showMoney
        ? { price: e.money ?? 0, paid: e.moneyIn ?? 0, addPrice: e.addPrice ?? 0, carry: e.moneyCarry ?? 0 }
        : {}),
    };
  });

  return NextResponse.json({
    rows,
    total: rows.length,
    showMoney,
    sums: showMoney ? { paid: entries.reduce((s, e) => s + (e.moneyIn ?? 0), 0) } : null,
    truncated: entries.length >= limit,
    from: fromDay, to: toDay,
  });
}
