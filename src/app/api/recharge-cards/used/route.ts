import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// الكروت المستخدمة مع المشترك الذي فُعّل له والتاريخ والساعة.
// ===== بحث (طلب محمد 2026-08-05) =====
// كانت الصفحة تعرض آخر ١٠٠٠ كارت بلا سبيل للوصول إلى كارتٍ بعينه: تبحث بعينك في ألف سطر،
// وما قبل الألف لا يُرى أصلاً. الآن: `?q=` سيريال أو اسم مشترك أو اسم من سحبه، و`?from=&to=`
// مدى تاريخ الاستخدام — **والبحث في الخادم** فيطال كل الكروت لا المعروض منها فقط.
export async function GET(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1; // عزل: كروت وباقات ومكاتب وكيل المستخدم

  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const from = sp.get("from");
  const to = sp.get("to");

  // مدى تاريخ الاستخدام (يشمل يوم البداية ويوم النهاية كاملاً)
  const useDate: { not: null; gte?: Date; lte?: Date } = { not: null };
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) useDate.gte = d; }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); useDate.lte = d; } }

  // البحث الحر: سيريال يحوي النص، أو مشترك اسمه يحوي النص (ضمن مكاتب الوكيل)، أو ساحب الكارت
  let qWhere: object = {};
  if (q) {
    const towers = await prisma.tower.findMany({ where: { agentId }, select: { id: true } });
    const subs = await prisma.subscriber.findMany({
      where: {
        name: { contains: q, mode: "insensitive" },
        towerId: { in: towers.length ? towers.map((t) => t.id) : [-1] },
      },
      select: { id: true },
      take: 1000,
    });
    qWhere = {
      OR: [
        { serial: { contains: q, mode: "insensitive" } },
        { userName: { contains: q, mode: "insensitive" } },
        ...(subs.length ? [{ subscriberId: { in: subs.map((s) => s.id) } }] : []),
      ],
    };
  }

  const where = { useDate, agentId, ...qWhere };
  const [cards, matched] = await Promise.all([
    prisma.rechargeCard.findMany({ where, orderBy: { useDate: "desc" }, take: 1000 }),
    prisma.rechargeCard.count({ where }),
  ]);

  const [subs, packages, towers] = await Promise.all([
    prisma.subscriber.findMany({
      where: { id: { in: cards.map((c) => c.subscriberId).filter(Boolean) as number[] } },
      select: { id: true, name: true, towerId: true },
    }),
    prisma.package.findMany({ where: { agentId }, select: { id: true, name: true } }),
    prisma.tower.findMany({ where: { agentId }, select: { id: true, name: true } }),
  ]);
  const subMap = new Map(subs.map((s) => [s.id, s]));
  const pkgMap = new Map(packages.map((p) => [p.id, p.name]));
  const towerMap = new Map(towers.map((t) => [t.id, t.name]));

  return NextResponse.json({
    matched,
    cards: cards.map((c) => {
      const sub = c.subscriberId ? subMap.get(c.subscriberId) : null;
      return {
        id: c.id,
        serial: c.serial,
        packageName: c.packageId ? pkgMap.get(c.packageId) ?? null : null,
        subscriber: sub?.name ?? null,
        // اسم المكتب الذي استخدم الكارت (مكتب المشترك المفعَّل له)
        office: sub?.towerId ? towerMap.get(sub.towerId) ?? null : null,
        useDate: c.useDate,
        userName: c.userName,
      };
    }),
  });
}
