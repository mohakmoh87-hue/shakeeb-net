import { prisma } from "@/lib/prisma";
import { sasBaseUrl, sasLogin, sasFetchActiveTotal, sasFetchOnlineCount } from "@/lib/sas4";
import { panelsOfTower, credsFromPanel, type SasCreds } from "@/lib/sasPanel";
import { decryptSecret } from "@/lib/secretbox";

// مجاميعُ مشتركي/أكتف/متصلي كلّ الوكلاء لمالك النظام. تستعمل أرقامَ حاسبات المكاتب المرفوعة
// (subStats) لمن رفعها حديثاً، وتسأل الساسَ مباشرةً (بالنداءات الرخيصة) للوكلاء بلا رفعٍ حيّ
// — فتشمل حتى الوكيلَ بلا حاسبةٍ كالقرصان، بأقلِّ نداءٍ ممكن.

export type OwnerAgentStat = { agentId: number; name: string; active: number; total: number; online: number | null; source: "live" | "worker" | "none" };
export type OwnerSubStats = {
  at: number;
  subscribers: number; active: number; online: number;
  totalAgents: number; reportedAgents: number;
  perAgent: OwnerAgentStat[];
};

const TTL = 5 * 60_000;
const FRESH = 15 * 60_000; // أرقامُ العامل تُقبَل ما دامت أحدثَ من ١٥د (يُغطّي دورةً فائتة)
let cache: { at: number; data: OwnerSubStats } | null = null;
let inflight: Promise<OwnerSubStats> | null = null;

type Sum = { active: number; total: number; online: number | null };

// أرقامُ حاسبات المكاتب المرفوعة (subStats:{agentId}) — مجموعةٌ لكلّ وكيلٍ مع وقتها.
async function workerSums(liveTowers: Set<number>): Promise<Map<number, Sum & { at: number; offices: number }>> {
  const rows = await prisma.systemSetting.findMany({ where: { type: { startsWith: "subStats:" } }, select: { type: true, text: true } });
  const out = new Map<number, Sum & { at: number; offices: number }>();
  for (const r of rows) {
    if (!r.type || !r.text) continue;
    const aid = Number(r.type.slice("subStats:".length));
    if (!Number.isInteger(aid)) continue;
    try {
      const d = JSON.parse(r.text) as { at?: string; offices?: Record<string, { active?: number; total?: number; online?: number | null }> };
      let active = 0, total = 0, online: number | null = null, offices = 0;
      for (const [tid, o] of Object.entries(d.offices ?? {})) {
        if (!liveTowers.has(Number(tid))) continue; // مكتبٌ محذوفٌ لا يُعَدّ (خزنُ العامل تراكميٌّ لا يمسح)
        offices++; active += o.active ?? 0; total += o.total ?? 0; if (o.online != null) online = (online ?? 0) + o.online;
      }
      out.set(aid, { active, total, online, at: d.at ? new Date(d.at).getTime() : 0, offices });
    } catch { /* نصٌّ فاسد — يُتجاهَل */ }
  }
  return out;
}

// كلُّ حسابات ساسِ الوكيل عبر مكاتبه: لوحاتُ المكتب إن وُجدت، وإلّا أعمدةُ المكتب.
async function agentScopes(agentId: number): Promise<SasCreds[]> {
  const towers = await prisma.tower.findMany({
    where: { agentId, isDeleted: false },
    select: { id: true, agentId: true, name: true, loginUrl: true, username: true, password: true, activationTemplate: true },
  });
  const out: SasCreds[] = [];
  for (const t of towers) {
    const panels = await panelsOfTower(t.id);
    let added = false;
    for (const p of panels) { const c = credsFromPanel(p); if (c) { out.push(c); added = true; } }
    if (!added && t.loginUrl && t.username && t.password) {
      out.push({ panelId: null, towerId: t.id, agentId: t.agentId, label: t.name, loginUrl: t.loginUrl, username: t.username, password: decryptSecret(t.password) ?? t.password, activationTemplate: t.activationTemplate });
    }
  }
  return out;
}

async function scopeCounts(c: SasCreds): Promise<Sum | null> {
  try {
    const base = sasBaseUrl(c.loginUrl);
    const token = await sasLogin(base, c.username, c.password);
    const [at, online] = await Promise.all([
      sasFetchActiveTotal(base, token),
      sasFetchOnlineCount(base, token).catch(() => null),
    ]);
    return { active: at.active, total: at.total, online };
  } catch { return null; }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

async function compute(): Promise<OwnerSubStats> {
  const liveTowers = new Set((await prisma.tower.findMany({ where: { isDeleted: false }, select: { id: true } })).map((t) => t.id));
  const [agents, worker] = await Promise.all([
    prisma.agent.findMany({ where: { isDeleted: false }, select: { id: true, name: true }, orderBy: { id: "asc" } }),
    workerSums(liveTowers),
  ]);
  const now = Date.now();
  // نثق برفعِ العامل فقط إن كان حديثاً **وله مكاتبُ حيّةٌ فعلاً** — فرفعةٌ فارغةٌ (ساسٌ متعذّرٌ
  // وقتَ الرفع) لا تُسكِت السؤالَ الحيّ، بل يُسأل الساسُ مباشرةً.
  const isFresh = (aid: number) => { const w = worker.get(aid); return !!w && now - w.at <= FRESH && w.offices > 0; };

  // نسأل الساسَ حيّاً فقط لمن لا رفعَ حديثاً صالحاً له
  const liveAgents = agents.filter((a) => !isFresh(a.id));
  const flat: { agentId: number; scope: SasCreds }[] = [];
  for (const a of liveAgents) for (const s of await agentScopes(a.id)) flat.push({ agentId: a.id, scope: s });
  const results = await mapLimit(flat, 5, async ({ agentId, scope }) => ({ agentId, counts: await scopeCounts(scope) }));

  const live = new Map<number, { sum: Sum; ok: boolean }>();
  for (const a of liveAgents) live.set(a.id, { sum: { active: 0, total: 0, online: null }, ok: false });
  for (const { agentId, counts } of results) {
    const e = live.get(agentId)!;
    if (counts) { e.ok = true; e.sum.active += counts.active; e.sum.total += counts.total; if (counts.online != null) e.sum.online = (e.sum.online ?? 0) + counts.online; }
  }

  let subscribers = 0, active = 0, online = 0, reportedAgents = 0;
  const perAgent: OwnerAgentStat[] = agents.map((a) => {
    let sum: Sum, source: OwnerAgentStat["source"];
    if (isFresh(a.id)) { const w = worker.get(a.id)!; sum = { active: w.active, total: w.total, online: w.online }; source = "worker"; }
    else { const lv = live.get(a.id)!; sum = lv.sum; source = lv.ok ? "live" : "none"; }
    if (source !== "none") { subscribers += sum.total; active += sum.active; if (sum.online != null) online += sum.online; reportedAgents++; }
    return { agentId: a.id, name: a.name, active: sum.active, total: sum.total, online: sum.online, source };
  });

  return { at: now, subscribers, active, online, totalAgents: agents.length, reportedAgents, perAgent };
}

export async function ownerSubStats(force = false): Promise<OwnerSubStats> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  if (inflight) return inflight;
  inflight = compute()
    .then((d) => { cache = { at: Date.now(), data: d }; return d; })
    .finally(() => { inflight = null; });
  return inflight;
}
