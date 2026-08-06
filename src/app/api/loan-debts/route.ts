import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, towerScope, agentTowerIds } from "@/lib/guard";

// قائمة «ديون القروض» — بلا زرّ تسديد، ولا تدخل التقرير اليوميّ. بحث + مدى تاريخ + فلتر مكتب للمدير.
// العزل (طلب محمد): الأساس towerScope (مستخدم المكتب ⇒ مكتبه، المدير ⇒ كلّ مكاتب وكيله)؛
// وفلتر المكتب للمدير مصادَقٌ عليه ضدّ agentTowerIds فلا يصل مكتب وكيلٍ آخر أبداً.
export async function GET(request: Request) {
  const g = await guard("finance.view");
  if (g.error) return g.error;
  const session = g.session;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const towerParam = url.searchParams.get("towerId");

  // نطاق العزل الأساسيّ
  let scope: { towerId?: number | { in: number[] } } = await towerScope(session);
  // فلتر مكتب للمدير: أحد مكاتبه فقط (مصادَق عليه — أي رقمٍ خارج مكاتبه ⇒ -1 = لا شيء)
  if (session?.isAdmin && towerParam && towerParam !== "all") {
    const agentTowers = await agentTowerIds(session);
    const t = Number(towerParam) || -1;
    scope = { towerId: agentTowers.includes(t) ? t : -1 };
  }

  // مدى التاريخ على تاريخ المنح
  const dateWhere: Record<string, unknown> = {};
  if (fromStr && toStr) {
    const from = new Date(fromStr + "T00:00:00");
    const to = new Date(toStr + "T23:59:59");
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) dateWhere.grantDate = { gte: from, lte: to };
  }

  const rows = await prisma.loanDebt.findMany({
    where: { isDeleted: false, ...scope, ...dateWhere },
    orderBy: { grantDate: "desc" },
    select: {
      id: true, subscriberId: true, towerId: true, amount: true, netUser: true,
      grantDate: true, expiryVirtual: true, createdByUser: true,
    },
  });

  // أسماء المكاتب + حالة التفعيل دفعةً — لإخفاء قروض المكاتب المطفأة (الميزة كأنها غير موجودة)
  const towerIds = [...new Set(rows.map((r) => r.towerId).filter((x): x is number => x != null))];
  const towers = towerIds.length
    ? await prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true, loanEnabled: true } })
    : [];
  const towerName = new Map(towers.map((t) => [t.id, t.name]));
  const loanOnSet = new Set(towers.filter((t) => t.loanEnabled === "1").map((t) => t.id));

  // المكاتب المطفأة: تُخفى قروضها تماماً (والدين محفوظ في القاعدة لإعادة التفعيل)
  const visibleRows = rows.filter((r) => r.towerId != null && loanOnSet.has(r.towerId));

  // أسماء/هواتف المشتركين دفعةً (معزولة بمعرّفات الصفوف الظاهرة)
  const subIds = [...new Set(visibleRows.map((r) => r.subscriberId))];
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, phone: true } })
    : [];
  const subMap = new Map(subs.map((s) => [s.id, s]));

  const mapped = visibleRows.map((r) => {
    const s = subMap.get(r.subscriberId);
    return {
      id: r.id, subscriberId: r.subscriberId,
      name: s?.name ?? null, phone: s?.phone ?? null, netUser: r.netUser,
      amount: r.amount, grantDate: r.grantDate, expiryVirtual: r.expiryVirtual,
      createdByUser: r.createdByUser,
      office: r.towerId != null ? (towerName.get(r.towerId) ?? null) : null,
    };
  });

  // بحث بالاسم/اليوزر/الهاتف (القائمة صغيرة — بعد الجلب)
  const ql = q.toLowerCase();
  const out = q
    ? mapped.filter((r) =>
        (r.name ?? "").includes(q) ||
        (r.netUser ?? "").toLowerCase().includes(ql) ||
        (r.phone ?? "").includes(q))
    : mapped;

  const total = out.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  return NextResponse.json({ rows: out, total, count: out.length });
}
