import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ===== كل الحركات المالية لمدير واحد (طلب محمد 2026-08-04) =====
// «أضغط على المدير فيظهر لي كلمة تفاصيل، ومنها كل الحركات المالية — حتى التي سجّلها
// المستخدم من حساب المصروفات والمقبوضات».
// المصدران:
//   ١) money_tx على حسابات المدير في المكاتب — وهذه بالضبط ما يسجّله المستخدم من
//      صفحة المصروفات والمقبوضات حين يختار حساب المدير (نقدياً أو ماستر).
//   ٢) manager_tx المنسوبة إليه — حسابات المدير العامة والماستر والرصيد السابق.
// تُدمجان في قائمة واحدة مرتّبة بالتاريخ، ولكل سطر مرجع حذفه الصحيح.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;

  const { id } = await params;
  const managerId = Number(id);
  if (!managerId) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });

  // عزل: المدير يجب أن يتبع وكيل المستخدم
  const manager = await prisma.manager.findFirst({
    where: { id: managerId, agentId, isDeleted: false },
    select: { id: true, name: true },
  });
  if (!manager) return NextResponse.json({ error: "المدير غير موجود" }, { status: 404 });

  const towerIds = await agentTowerIds(g.session);
  const [accounts, towers] = await Promise.all([
    prisma.account.findMany({ where: { managerId, isDeleted: false }, select: { id: true, towerId: true } }),
    prisma.tower.findMany({ where: { id: { in: towerIds.length ? towerIds : [-1] } }, select: { id: true, name: true } }),
  ]);
  const officeName = new Map(towers.map((t) => [t.id, t.name ?? `مكتب ${t.id}`]));
  const accIds = accounts.map((a) => a.id);

  const [officeTxs, mgrTxs] = await Promise.all([
    accIds.length
      ? prisma.moneyTx.findMany({
          where: { isDeleted: false, accountId: { in: accIds } },
          orderBy: { id: "desc" },
          take: 1000,
          select: { id: true, moneyIn: true, moneyOut: true, notes: true, date: true, towerId: true, sourceType: true, userId: true },
        })
      : Promise.resolve([]),
    prisma.managerTx.findMany({
      where: { isDeleted: false, agentId, managerId },
      orderBy: { id: "desc" },
      take: 1000,
      select: { id: true, type: true, amount: true, notes: true, date: true, byUser: true },
    }),
  ]);

  const userIds = [...new Set(officeTxs.map((t) => t.userId).filter((x): x is number => x != null))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.fullName ?? u.username]));

  const MGR_LABEL: Record<string, string> = {
    receipt: "مقبوض (حسابات المدير)", expense: "مصروف (حسابات المدير)",
    "master-receipt": "🅜 قبض ماستر", "master-expense": "🅜 صرف ماستر",
    "opening-receipt": "رصيد سابق (إكسل) — أعطى", "opening-expense": "رصيد سابق (إكسل) — سحب",
    salary: "راتب فني", "card-payment": "تسديد كارتات",
    "card-debt-add": "إضافة لديون الكارتات", "card-debt-sub": "إنقاص من ديون الكارتات",
  };
  const DEPOSIT_TYPES = ["receipt", "master-receipt", "opening-receipt"];

  const rows = [
    // قناة المكاتب: قبضُ المكتب = أعطى المدير · صرفُ المكتب = سحب المدير
    ...officeTxs.map((t) => ({
      key: `m${t.id}`,
      id: t.id,
      source: "money" as const,
      date: t.date,
      office: t.towerId != null ? officeName.get(t.towerId) ?? null : null,
      kind: t.sourceType === "master" || t.sourceType === "master-invoice" ? "🅜 ماستر (مكتب)" : "مصروف/مقبوض (مكتب)",
      deposited: t.moneyIn ?? 0,
      withdrawn: t.moneyOut ?? 0,
      notes: t.notes,
      by: t.userId != null ? userName.get(t.userId) ?? null : null,
      affectsReport: t.sourceType !== "master" && t.sourceType !== "master-invoice",
    })),
    ...mgrTxs.map((t) => ({
      key: `g${t.id}`,
      id: t.id,
      source: "manager" as const,
      date: t.date,
      office: null as string | null,
      kind: MGR_LABEL[t.type] ?? t.type,
      deposited: DEPOSIT_TYPES.includes(t.type) ? t.amount : 0,
      withdrawn: DEPOSIT_TYPES.includes(t.type) ? 0 : t.amount,
      notes: t.notes,
      by: t.byUser,
      affectsReport: false,
    })),
  ].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  const deposited = rows.reduce((s, r) => s + r.deposited, 0);
  const withdrawn = rows.reduce((s, r) => s + r.withdrawn, 0);

  return NextResponse.json({
    manager,
    rows,
    totals: { deposited, withdrawn, net: deposited - withdrawn, count: rows.length },
  });
}
