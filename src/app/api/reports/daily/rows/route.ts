import { NextResponse } from "next/server";
import { notMaster, onlyMaster, otherIncomeOnly } from "@/lib/moneyKinds";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { iraqTodayRange, reportUserScope } from "@/lib/dailyReport";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// ===== «الضغط على المبلغ يفتح مكوّناته» — أسطر التقرير اليومي (المرحلة ٥) =====
// كل سطر في بطاقة التقرير كان رقماً جامداً لا سبيل لمعرفة مِمَّ تكوّن. هذا المسار
// يُرجع الحركات الفعلية وراء كل سطر ليوم العراق الحالي وللمكتب المعروض.
// الأنواع تطابق تعريفات computeDailyReport حرفاً بحرف كي لا يختلف المجموع عن التفصيل.
const KINDS = ["activation", "invoice", "sale", "other", "expenses", "master", "total"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (!can(session, "finance.view") && !can(session, "finance.manage")) {
    return NextResponse.json({ error: "ليس لديك صلاحية" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const kind = (sp.get("kind") ?? "total") as Kind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "نوع غير معروف" }, { status: 400 });

  // نطاق المكتب: نفس منطق /api/reports/daily — ومَن بلا مكتب يُقيَّد بمكاتب وكيله
  const agentTowers = await agentTowerIds(session);
  const param = sp.get("towerId");
  let towerWhere: object;
  if (session.isAdmin) {
    if (!param || param === "all") towerWhere = { towerId: { in: agentTowers.length ? agentTowers : [-1] } };
    else {
      const t = Number(param) || -1;
      towerWhere = { towerId: agentTowers.includes(t) ? t : -1 };
    }
  } else {
    towerWhere = session.towerId != null
      ? { towerId: session.towerId }
      : { towerId: { in: agentTowers.length ? agentTowers : [-1] } };
  }

  // فلتر المستخدم (تقارير المكاتب متعدّدة المستخدمين): المدير يختاره (بتحقّق من وكيله)،
  // ومستخدم مكتبٍ فيه مستخدمان+ يُجبَر على حركاته هو وحده
  let userWhere: object = {};
  if (session.isAdmin) {
    const uParam = Number(sp.get("userId")) || 0;
    if (uParam > 0) {
      const u = await prisma.user.findFirst({ where: { id: uParam, agentId: session.agentId ?? -1, isDeleted: false }, select: { id: true } });
      if (u) userWhere = { userId: u.id };
    }
  } else {
    const forced = await reportUserScope(session);
    if (forced != null) userWhere = { userId: forced };
  }

  const { start, end } = iraqTodayRange();
  const dateWhere = { date: { gte: start, lte: end } };
  const base = { isDeleted: false, ...dateWhere, ...towerWhere, ...userWhere };

  // «المقبوضات (اليوم)» = ما ليس تفعيلاً ولا فاتورة ولا بيع مخزن ولا ماستر:
  // تسديدات الديون والحركات اليدوية. تعريفٌ صريح يمكن سرده — بخلاف الطرح القديم.
  // التعريفات من مصدر واحد — لا تُكتب يدوياً هنا

  const whereByKind: Record<Kind, object> = {
    activation: { ...base, sourceType: "activation" },
    invoice: { ...base, sourceType: "invoice" },
    sale: { ...base, sourceType: "sale" },
    other: { ...base, ...otherIncomeOnly },
    expenses: { ...base, moneyOut: { gt: 0 }, ...notMaster },
    master: { ...base, ...onlyMaster },
    total: { ...base, ...notMaster },
  };

  const where = whereByKind[kind];
  const [txs, agg, towers] = await Promise.all([
    prisma.moneyTx.findMany({
      where,
      orderBy: { id: "desc" },
      take: 500,
      select: { id: true, moneyIn: true, moneyOut: true, notes: true, date: true, towerId: true, sourceType: true, accountId: true, userId: true },
    }),
    prisma.moneyTx.aggregate({ where, _sum: { moneyIn: true, moneyOut: true }, _count: true }),
    prisma.tower.findMany({ where: { id: { in: agentTowers.length ? agentTowers : [-1] } }, select: { id: true, name: true } }),
  ]);

  const officeName = new Map(towers.map((t) => [t.id, t.name ?? `مكتب ${t.id}`]));
  const userIds = [...new Set(txs.map((t) => t.userId).filter((x): x is number => x != null))];
  const accIds = [...new Set(txs.map((t) => t.accountId).filter((x): x is number => x != null))];
  const [users, accounts] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } }) : Promise.resolve([]),
    accIds.length ? prisma.account.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.fullName ?? u.username]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));

  return NextResponse.json({
    kind,
    rows: txs.map((t) => ({
      id: t.id,
      date: t.date,
      moneyIn: t.moneyIn ?? 0,
      moneyOut: t.moneyOut ?? 0,
      notes: t.notes,
      office: t.towerId != null ? officeName.get(t.towerId) ?? null : null,
      account: t.accountId != null ? accName.get(t.accountId) ?? null : null,
      by: t.userId != null ? userName.get(t.userId) ?? null : null,
      sourceType: t.sourceType,
    })),
    totals: {
      count: agg._count,
      moneyIn: agg._sum.moneyIn ?? 0,
      moneyOut: agg._sum.moneyOut ?? 0,
      net: (agg._sum.moneyIn ?? 0) - (agg._sum.moneyOut ?? 0),
    },
    truncated: agg._count > txs.length,
  });
}
