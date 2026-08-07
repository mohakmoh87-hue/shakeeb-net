import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { onlyMaster } from "@/lib/moneyKinds";

export const dynamic = "force-dynamic";

// تفاصيل حساب الماستر — الحركات مجمّعة حسب اليوم (تفعيلات ماستر + قبض/صرف ماستر).
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;

  // عزل المستأجر: ماستر مكاتب وكيل المستخدم فقط
  const agentTowers = await agentTowerIds(g.session);
  const officeTxs = await prisma.moneyTx.findMany({
    where: { isDeleted: false, ...onlyMaster, towerId: { in: agentTowers.length ? agentTowers : [-1] } },
    orderBy: { date: "desc" },
    take: 500,
    select: { id: true, moneyIn: true, moneyOut: true, notes: true, date: true, towerId: true, userId: true },
  });
  // اسم مَن سجّل كل حركة — تدقيق حركات الماستر كان مستحيلاً بلا هذا
  const txUserIds = [...new Set(officeTxs.map((t) => t.userId).filter((x): x is number => x != null))];
  const txUsers = txUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: txUserIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const userName = new Map(txUsers.map((u) => [u.id, u.fullName ?? u.username]));
  // حركات ماستر المدير (طبقة الوكيل بلا مكاتب — قرار محمد 2026-07-30): تُدمج في
  // الرصيد والسجل اليومي بلا مكتب، فلا تمس ماستر المكاتب ولا تقاريرها
  const mgrTxs = await prisma.managerTx.findMany({
    where: { isDeleted: false, agentId: g.session.agentId ?? -1, type: { in: ["master-receipt", "master-expense"] } },
    orderBy: { date: "desc" },
    take: 200,
    select: { id: true, type: true, amount: true, notes: true, date: true },
  });
  const txs = [
    ...officeTxs.map((t) => ({
      id: t.id, moneyIn: t.moneyIn, moneyOut: t.moneyOut, notes: t.notes, date: t.date,
      towerId: t.towerId, by: t.userId != null ? userName.get(t.userId) ?? null : null,
    })),
    ...mgrTxs.map((m) => ({
      id: -m.id, // معرّف سالب: تمييزها عن حركات المكاتب في القائمة
      moneyIn: m.type === "master-receipt" ? m.amount : 0,
      moneyOut: m.type === "master-expense" ? m.amount : 0,
      notes: `🧾 حساب المدير — ${m.notes ?? (m.type === "master-receipt" ? "قبض ماستر" : "صرف ماستر")}`,
      date: m.date, towerId: null as number | null, by: null as string | null,
    })),
  ].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  const offices = await prisma.tower.findMany({ where: { id: { in: agentTowers.length ? agentTowers : [-1] } }, select: { id: true, name: true } });
  const officeName = new Map(offices.map((o) => [o.id, o.name ?? `مكتب ${o.id}`]));

  // تجميع يومي (بتوقيت بغداد UTC+3) + تفصيل ماستر كل مكتب داخل اليوم (لا المجموع فقط)
  type DayAgg = { day: string; in: number; out: number; count: number; byOffice: Map<number, number> };
  const byDay = new Map<string, DayAgg>();
  for (const t of txs) {
    const d = new Date((t.date ?? new Date()).getTime() + 3 * 60 * 60 * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const cur = byDay.get(key) ?? { day: key, in: 0, out: 0, count: 0, byOffice: new Map<number, number>() };
    const net = (t.moneyIn ?? 0) - (t.moneyOut ?? 0);
    cur.in += t.moneyIn ?? 0; cur.out += t.moneyOut ?? 0; cur.count += 1;
    if (t.towerId != null) cur.byOffice.set(t.towerId, (cur.byOffice.get(t.towerId) ?? 0) + net);
    byDay.set(key, cur);
  }
  const days = [...byDay.values()].map((x) => ({
    day: x.day, in: x.in, out: x.out, count: x.count, net: x.in - x.out,
    offices: [...x.byOffice.entries()].map(([tid, net]) => ({ towerId: tid, name: officeName.get(tid) ?? `#${tid}`, net })),
  }));
  const balance = days.reduce((s, x) => s + x.net, 0);

  return NextResponse.json({
    balance, days,
    // الحركات المفردة — بلا هذه القائمة كانت حركة الماستر تُسجَّل ولا تظهر في أي
    // مكان فيه زر حذف (صفحة الصندوق تعرض اليدوي فقط)، فتبقى خطأً لا يُمحى.
    transactions: txs.map((t) => ({ ...t, office: t.towerId != null ? officeName.get(t.towerId) ?? null : null })),
  });
}
