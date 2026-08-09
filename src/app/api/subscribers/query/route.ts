import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { decryptSecret } from "@/lib/secretbox";

export const dynamic = "force-dynamic";

// ===== استعلام صفحة «كلّ المشتركين» (طلب محمد 2026-08-09) =====
// فلاتر: مكتب · بحث · «ينتهي خلال N يوماً» أو «إلى تاريخ» · «منتهون بين تاريخين» · فعّال/متصل/الكل.
// العزل (شرط دائم): مستخدم المكتب ⇒ مكتبه حصراً (لا يُقبل منه أيّ officeId آخر)؛
// المدير ⇒ مكاتب وكيله فقط (كلّ officeId مُصادَق ضدّ agentTowerIds).
export async function GET(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const session = g.session!;

  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const status = sp.get("status") ?? "all"; // all | active | online | expired
  const officeParam = sp.get("office") ?? "all";
  const days = Number(sp.get("days")) || 0; // ينتهي خلال N يوماً (1/2/3/…)
  const until = sp.get("until"); // ينتهي إلى تاريخ محدّد (YYYY-MM-DD)
  const from = sp.get("from"); // منتهون بين تاريخين
  const to = sp.get("to");
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 500, 1), 2000);
  const page = Math.max(Number(sp.get("page")) || 1, 1);

  // ===== نطاق المكاتب (عزل) =====
  const agentTowers = await agentTowerIds(session);
  const isOfficeUser = !session.isAdmin && session.towerId != null;
  let towerIds: number[];
  if (isOfficeUser) {
    towerIds = [session.towerId!]; // مستخدم المكتب: مكتبه فقط — يُهمَل أيّ طلبٍ لغيره
  } else if (officeParam !== "all") {
    const t = Number(officeParam) || -1;
    towerIds = agentTowers.includes(t) ? [t] : [-1]; // مكتب وكيله فقط
  } else {
    towerIds = agentTowers.length ? agentTowers : [-1];
  }

  const now = new Date();
  const endOf = (d: string): Date => new Date(d + "T23:59:59");

  // ===== شرط التاريخ حسب الفلتر =====
  let dateWhere: Record<string, unknown> = {};
  if (from && to) {
    // منتهون بين تاريخين (على تاريخ الانتهاء)
    const f = new Date(from + "T00:00:00");
    const t = endOf(to);
    if (!isNaN(f.getTime()) && !isNaN(t.getTime())) dateWhere = { dateTo: { not: null, gte: f, lte: t } };
  } else if (until) {
    const t = endOf(until);
    if (!isNaN(t.getTime())) dateWhere = { dateTo: { not: null, gte: now, lte: t } };
  } else if (days > 0) {
    const t = new Date();
    t.setDate(t.getDate() + days);
    t.setHours(23, 59, 59, 999);
    dateWhere = { dateTo: { not: null, gte: now, lte: t } };
  } else if (status === "active") {
    dateWhere = { dateTo: { not: null, gte: now } }; // فعّال = لم ينتهِ بعد
  } else if (status === "expired") {
    dateWhere = { dateTo: { not: null, lt: now } };
  }

  const where = {
    isDeleted: false,
    towerId: { in: towerIds },
    ...dateWhere,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { netUser: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { address: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.subscriber.findMany({
      where,
      select: {
        id: true, name: true, phone: true, address: true, netUser: true, packageId: true,
        towerId: true, dateTo: true, carry: true, waEnabled: true,
      },
      orderBy: [{ dateTo: "asc" }, { name: "asc" }],
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.subscriber.count({ where }),
  ]);

  // أسماء المكاتب والباقات (للعرض)
  const [towers, packages] = await Promise.all([
    prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } }),
    prisma.package.findMany({ where: { agentId: session.agentId ?? -1, isDeleted: false }, select: { id: true, name: true, priceDinar: true } }),
  ]);
  const officeName = new Map(towers.map((t) => [t.id, t.name]));
  const pkg = new Map(packages.map((p) => [p.id, p]));

  // ===== فلتر «المتصلين»: قائمة المتّصلين من ساس كلّ مكتب (عند الطلب فقط) =====
  let onlineSets: Map<number, Set<string> | null> | null = null;
  if (status === "online") {
    onlineSets = new Map();
    const creds = await prisma.tower.findMany({
      where: { id: { in: towerIds }, isDeleted: false, loginUrl: { not: null }, username: { not: null }, password: { not: null } },
      select: { id: true, loginUrl: true, username: true, password: true },
    });
    const { sasBaseUrl, sasLogin, sasFetchOnlineUsernames } = await import("@/lib/sas4");
    for (const c of creds) {
      try {
        const base = sasBaseUrl(c.loginUrl!);
        const token = await sasLogin(base, c.username!, decryptSecret(c.password) ?? c.password!);
        onlineSets.set(c.id, await sasFetchOnlineUsernames(base, token));
      } catch { onlineSets.set(c.id, null); }
    }
  }

  let mapped = rows.map((s) => {
    const p = s.packageId != null ? pkg.get(s.packageId) : null;
    const onlineSet = onlineSets && s.towerId != null ? onlineSets.get(s.towerId) : undefined;
    const online = onlineSet == null ? null : onlineSet.has((s.netUser ?? "").trim().toLowerCase());
    return {
      id: s.id, name: s.name, phone: s.phone, address: s.address, netUser: s.netUser,
      dateTo: s.dateTo, carry: s.carry ?? 0, waEnabled: s.waEnabled,
      office: s.towerId != null ? officeName.get(s.towerId) ?? null : null,
      towerId: s.towerId,
      packageName: p?.name ?? null, price: p?.priceDinar ?? 0,
      online,
    };
  });
  if (status === "online") mapped = mapped.filter((r) => r.online === true);

  return NextResponse.json({
    rows: mapped,
    total: status === "online" ? mapped.length : total,
    page, limit,
    truncated: status !== "online" && total > rows.length,
  });
}
