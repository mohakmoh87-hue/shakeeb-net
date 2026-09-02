import { prisma } from "./prisma";
import { ownerSubStats, type OwnerAgentStat } from "./ownerSubStats";
import { MAX_VALID_SEC } from "./achievements";
import type { AnalyticsView } from "./appConfig";

// تجميعُ أداء الوكلاء لبوّابة الشركة (سوبر سيل فوق كلّ الوكلاء بحكم التصميم). عرضان يتحكّم
// بهما المالك: «tickets» = تذاكرُ الشركة + عدّاداتُ المشتركين · «field» = أداءُ لوحة الفنيين
// من CardCompletion الدائم. لا يُخدَم إلّا لجلسة الشركة (لا جلسة وكيل).

export const FAMILIES = ["تنصيب", "صيانة", "توصيل", "تحويل", "إعادة", "أخرى"] as const;
export type Family = (typeof FAMILIES)[number];

export function familyOfKind(kind: string | null | undefined): Family {
  const k = (kind ?? "").trim();
  if (!k) return "أخرى";
  if (k.includes("تنصيب") || k.includes("سحب")) return "تنصيب";
  if (k.includes("تحويل")) return "تحويل";
  if (k.includes("اعادة") || k.includes("إعادة")) return "إعادة";
  if (k === "maintenance" || k.includes("صيانة")) return "صيانة";
  if (k.includes("توصيل")) return "توصيل";
  return "أخرى";
}

export type TicketStatusCounts = { new: number; contacted: number; done: number; rejected: number; total: number };
export type FieldPerf = { completed: number; avgSec: number | null; slaPct: number | null; byFamily: Record<Family, number> };
export type AgentPerf = {
  agentId: number;
  name: string;
  counts: { total: number; active: number; online: number | null; source: OwnerAgentStat["source"] } | null;
  tickets: { byStatus: TicketStatusCounts; byType: Record<string, number> } | null;
  field: FieldPerf | null;
};
export type AnalyticsSummary = {
  counts: { subscribers: number; active: number; online: number } | null;
  tickets: TicketStatusCounts | null;
  field: { completed: number; avgSec: number | null; slaPct: number | null; needsFollowup: number } | null;
};

function emptyFamilies(): Record<Family, number> {
  return { "تنصيب": 0, "صيانة": 0, "توصيل": 0, "تحويل": 0, "إعادة": 0, "أخرى": 0 };
}

export async function computeAgentAnalytics(
  view: AnalyticsView, from: Date, to: Date,
): Promise<{ at: number; view: AnalyticsView; agents: AgentPerf[]; summary: AnalyticsSummary }> {
  const wantTickets = view === "tickets" || view === "both";
  const wantField = view === "field" || view === "both";

  const agentRows = await prisma.agent.findMany({
    where: { isDeleted: false }, select: { id: true, name: true }, orderBy: { id: "asc" },
  });
  const byId = new Map<number, AgentPerf>();
  for (const a of agentRows) byId.set(a.id, { agentId: a.id, name: a.name, counts: null, tickets: null, field: null });
  // كلُّ التجميعات مقصورةٌ على الوكلاء الأحياء — كي يطابق الملخّصُ (البطاقات) مجموعَ الصفوف
  // (البطاقاتُ المكتملة دائمةٌ فقد تحمل agentId لوكيلٍ حُذف — يُقصى من الملخّص واللوحة معاً).
  const liveIds = [...byId.keys()];

  const summary: AnalyticsSummary = { counts: null, tickets: null, field: null };

  if (wantTickets) {
    const stats = await ownerSubStats().catch(() => null);
    const statMap = new Map<number, OwnerAgentStat>();
    if (stats) for (const p of stats.perAgent) statMap.set(p.agentId, p);
    if (stats) summary.counts = { subscribers: stats.subscribers, active: stats.active, online: stats.online };

    const [byStatus, byType] = await Promise.all([
      prisma.subscriberTicket.groupBy({
        by: ["agentId", "status"],
        where: { createdAt: { gte: from, lte: to }, agentId: { in: liveIds } },
        _count: { _all: true },
      }),
      prisma.subscriberTicket.groupBy({
        by: ["agentId", "type"],
        where: { createdAt: { gte: from, lte: to }, agentId: { in: liveIds } },
        _count: { _all: true },
      }),
    ]);

    for (const a of byId.values()) {
      const p = statMap.get(a.agentId);
      a.counts = p && p.source !== "none"
        ? { total: p.total, active: p.active, online: p.online, source: p.source }
        : null;
      a.tickets = { byStatus: { new: 0, contacted: 0, done: 0, rejected: 0, total: 0 }, byType: {} };
    }
    const tSum: TicketStatusCounts = { new: 0, contacted: 0, done: 0, rejected: 0, total: 0 };
    for (const r of byStatus) {
      const a = r.agentId != null ? byId.get(r.agentId) : null;
      const n = r._count._all;
      const st = r.status === "new" || r.status === "contacted" || r.status === "done" || r.status === "rejected" ? r.status : null;
      // العدّادُ الكلّيّ = مجموعُ الخانات الأربع (الحالةُ محصورةٌ فيها) — فلا رقمٌ يتيمٌ لا يجمع
      if (st) { tSum[st] += n; tSum.total += n; }
      if (!a?.tickets) continue;
      if (st) { a.tickets.byStatus[st] += n; a.tickets.byStatus.total += n; }
    }
    for (const r of byType) {
      const a = r.agentId != null ? byId.get(r.agentId) : null;
      if (!a?.tickets) continue;
      const t = (r.type ?? "").trim() || "أخرى";
      a.tickets.byType[t] = (a.tickets.byType[t] ?? 0) + r._count._all;
    }
    summary.tickets = tSum;
  }

  if (wantField) {
    const [byKind, avgRows, slaRows] = await Promise.all([
      prisma.cardCompletion.groupBy({
        by: ["agentId", "kind"],
        where: { completedAt: { gte: from, lte: to }, agentId: { in: liveIds } },
        _count: { _all: true },
      }),
      prisma.cardCompletion.groupBy({
        by: ["agentId"],
        where: {
          completedAt: { gte: from, lte: to }, agentId: { in: liveIds },
          durationSec: { gt: 0, lte: MAX_VALID_SEC },
          OR: [{ kind: null }, { kind: { not: { contains: "توصيل" } } }],
        },
        _avg: { durationSec: true }, _count: { _all: true },
      }),
      prisma.cardCompletion.groupBy({
        by: ["agentId", "onTime"],
        where: { completedAt: { gte: from, lte: to }, agentId: { in: liveIds }, onTime: { not: null } },
        _count: { _all: true },
      }),
    ]);

    for (const a of byId.values()) a.field = { completed: 0, avgSec: null, slaPct: null, byFamily: emptyFamilies() };
    let totalCompleted = 0;
    for (const r of byKind) {
      const a = r.agentId != null ? byId.get(r.agentId) : null;
      const n = r._count._all;
      totalCompleted += n;
      if (!a?.field) continue;
      a.field.completed += n;
      a.field.byFamily[familyOfKind(r.kind)] += n;
    }
    let wSum = 0, wCnt = 0;
    for (const r of avgRows) {
      const a = r.agentId != null ? byId.get(r.agentId) : null;
      if (r._avg.durationSec != null) { wSum += r._avg.durationSec * r._count._all; wCnt += r._count._all; }
      if (a?.field) a.field.avgSec = r._avg.durationSec != null ? Math.round(r._avg.durationSec) : null;
    }
    const sla = new Map<number, { t: number; f: number }>();
    let slaT = 0, slaF = 0;
    for (const r of slaRows) {
      if (r.agentId == null) continue;
      const e = sla.get(r.agentId) ?? { t: 0, f: 0 };
      if (r.onTime === true) { e.t += r._count._all; slaT += r._count._all; }
      else if (r.onTime === false) { e.f += r._count._all; slaF += r._count._all; }
      sla.set(r.agentId, e);
    }
    let needsFollowup = 0;
    for (const [aid, e] of sla) {
      const a = byId.get(aid);
      if (a?.field && e.t + e.f > 0) {
        a.field.slaPct = Math.round((e.t / (e.t + e.f)) * 100);
        if (a.field.slaPct < 75) needsFollowup++;
      }
    }
    summary.field = {
      completed: totalCompleted,
      avgSec: wCnt > 0 ? Math.round(wSum / wCnt) : null,
      slaPct: slaT + slaF > 0 ? Math.round((slaT / (slaT + slaF)) * 100) : null,
      needsFollowup,
    };
  }

  return { at: Date.now(), view, agents: [...byId.values()], summary };
}
