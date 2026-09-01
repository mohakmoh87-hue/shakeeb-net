import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanySession } from "@/lib/companyAuth";
import { getSubsVisibleToCompany } from "@/lib/appConfig";
import { towerIdsOfAgent } from "@/lib/guard";
import { subscriberState } from "@/lib/subscriberLogin";
import { formatExpiryDay } from "@/lib/format";

export const dynamic = "force-dynamic";
const PAGE = 30;

// ═════ القطعة ٧-ب — قراءةُ الشركة لمشتركي **وكيلٍ واحدٍ صريح** (أخطرُ باب) ═════
// كشفٌ متعمَّدٌ عابرٌ للوكلاء **للقراءة فقط**، مشروطٌ بموافقة المالك عبر علَمٍ مطفأٍ افتراضاً.
// العزل: الشركةُ ترى وكيلاً واحداً في كلّ استعلامٍ بمعرّفٍ مُصادَق، عبر مكاتبه حصراً (towerIdsOfAgent)
// — لا «كلّ الوكلاء». قائمةٌ بيضاءُ صارمة: لا كلماتِ سرٍّ ولا بيانات SAS/ناتو ولا قرض/ماليّات.
export async function GET(request: Request) {
  const s = await getCompanySession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (s.role !== "manager") return NextResponse.json({ error: "للمدير فقط" }, { status: 403 }); // مشتركو الوكلاء للمدير حصراً
  if (!(await getSubsVisibleToCompany())) return NextResponse.json({ error: "الكشفُ مُطفأٌ من المالك" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const agentId = Number(sp.get("agentId")) || 0;
  if (!agentId) return NextResponse.json({ error: "اختر وكيلاً" }, { status: 400 });
  const agent = await prisma.agent.findFirst({ where: { id: agentId, isDeleted: false }, select: { id: true, name: true } });
  if (!agent) return NextResponse.json({ error: "وكيلٌ غير موجود" }, { status: 404 });

  const towerIds = await towerIdsOfAgent(agentId);
  if (towerIds.length === 0) return NextResponse.json({ agent, subscribers: [], total: 0, page: 1, pages: 0 });

  const page = Math.max(1, Number(sp.get("page")) || 1);
  const q = (sp.get("q") ?? "").trim();
  const where = {
    isDeleted: false,
    purgedAt: null,
    towerId: { in: towerIds },
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }] } : {}),
  };
  const total = await prisma.subscriber.count({ where });
  const rows = await prisma.subscriber.findMany({
    where,
    // 🔒 قائمةٌ بيضاءُ صارمة — حقولُ العرض الآمنة فقط، لا أيّ سرٍّ
    select: { id: true, name: true, phone: true, towerId: true, packageId: true, dateFrom: true, dateTo: true },
    orderBy: { id: "desc" },
    take: PAGE,
    skip: (page - 1) * PAGE,
  });
  const pkgIds = [...new Set(rows.map((r) => r.packageId).filter((x): x is number => x != null))];
  const [towers, packages] = await Promise.all([
    prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } }),
    pkgIds.length ? prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const towerName = new Map(towers.map((t) => [t.id, t.name] as const));
  const pkgName = new Map(packages.map((p) => [p.id, p.name] as const));
  const subscribers = rows.map((r) => {
    const st = subscriberState(r.dateTo);
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      office: r.towerId != null ? (towerName.get(r.towerId) ?? null) : null,
      package: r.packageId != null ? (pkgName.get(r.packageId) ?? null) : null,
      expiry: r.dateTo ? formatExpiryDay(r.dateTo) : "",
      state: st.state,
      daysExpired: st.daysExpired,
    };
  });
  return NextResponse.json({ agent, subscribers, total, page, pages: Math.ceil(total / PAGE) });
}
