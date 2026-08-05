import { prisma } from "@/lib/prisma";
import { currentPeriodFromDays } from "@/lib/salary";
import { baghdadDayKey } from "@/lib/attendance";

// ===== إنجازات الفنيين ومسابقة الشهر (طلب محمد 2026-08-05) =====
// كان الترتيب بالعدد وحده مضلّلاً: التوصيل **نصف كل ما يُنجَز** (٢٦٧ من ٥٣٥ في فترة
// تموز) وهو أسهلها وبلا زمن أصلاً — فمن يأخذ توصيلات كثيرة يبدو الأكثر إنجازاً.
//
// القاعدة كما أملاها محمد: لكل فئة **وزن صعوبة**، ولكل بطاقة **معامل سرعة** يقارن زمنها
// بمتوسط **فئتها هي** لا بمتوسط عام (وإلا ظُلم من يأخذ التنصيبات الطويلة).
//
//   نقاط البطاقة = وزن الفئة × معامل السرعة
//   نقاط الفني   = مجموع نقاط بطاقاته في الفترة
//
// والوزن يغلب السرعة عمداً: صيانةٌ خارقة (٢×١٫٦ = ٣٫٢) تبقى دون تنصيبٍ عاديّ (٥).

// أوزان الصعوبة — ثابتة في الكود بقرار محمد (لا تُعدَّل من الشاشة)
export const KIND_WEIGHTS: { label: string; weight: number }[] = [
  { label: "تنصيب", weight: 5 },
  { label: "سحب جديد", weight: 5 }, // «هو نفسه تنصيب»
  { label: "تحويل", weight: 4 },
  { label: "اعادة", weight: 3 },
  { label: "صيانة", weight: 2 },
  { label: "توصيل", weight: 0.5 },
];
export const DEFAULT_WEIGHT = 1; // أي نوع جديد يضيفه الوكيل ⇒ نقطة واحدة

const norm = (s: string | null | undefined) => (s ?? "").trim();

export function weightOfKind(kind: string | null | undefined): number {
  const k = norm(kind);
  if (!k) return DEFAULT_WEIGHT;
  const exact = KIND_WEIGHTS.find((w) => w.label === k);
  if (exact) return exact.weight;
  // مرادفات شائعة كتبها المستخدم بصيغة أخرى («إعادة» بهمزة، maintenance بالإنجليزية،
  // «تنصيب جديد»…) تُنسب لعائلتها بدل أن تسقط إلى وزن النوع الجديد
  if (k.includes("تنصيب") || k.includes("سحب")) return 5;
  if (k.includes("تحويل")) return 4;
  if (k.includes("اعادة") || k.includes("إعادة")) return 3;
  if (k === "maintenance" || k.includes("صيانة")) return 2;
  if (k.includes("توصيل")) return 0.5;
  return DEFAULT_WEIGHT;
}

// زمنٌ يتجاوز ٤ ساعات = نسيانُ ضغط «إنجاز» غالباً لا عملٌ فعليّ — يُعرض ولا يُفسد المتوسط
export const MAX_VALID_SEC = 4 * 3600;
const SPEED_MIN = 0.6, SPEED_MAX = 1.6; // حدّا معامل السرعة (الصعوبة تغلب السرعة عمداً)
export const MIN_CARDS_FOR_CROWN = 5; // لا تتويج بأقلّ من خمس بطاقات

export type TechRow = {
  technicianId: number; name: string; office: string | null;
  cards: number; points: number;
  byKind: { kind: string; count: number; avgMin: number | null; weight: number }[];
  avgMin: number | null; // متوسط عام (للفئات ذات الزمن فقط) — للعرض السريع
  timed: number; // كم بطاقة لها زمن صالح
};

// حصاد المكتب: كم بطاقة من كل فئة أُنجزت فيه — ومجموع كل المكاتب (طلب محمد)
export type OfficeTally = { towerId: number | null; office: string; total: number; kinds: { kind: string; count: number }[] };

export type Achievements = {
  from: string | null; to: string | null;
  rows: TechRow[];
  leader: TechRow | null;
  kindAvg: { kind: string; avgMin: number | null; count: number; weight: number }[];
  byOffice: OfficeTally[];
  totals: { total: number; kinds: { kind: string; count: number }[] };
  weights: { label: string; weight: number }[];
  defaultWeight: number;
  minCards: number;
};

// الفترة الافتراضية = فترة الراتب الحالية للوكيل (تبدأ يوم كذا وتنتهي يوم كذا)
export async function currentSalaryPeriod(agentId: number | null): Promise<{ from: string; to: string } | null> {
  if (agentId == null) return null;
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { salaryFromDay: true, salaryToDay: true } });
  return currentPeriodFromDays(a?.salaryFromDay ?? null, a?.salaryToDay ?? null, baghdadDayKey(new Date()));
}

// يوم بغداد (YYYY-MM-DD) ⇒ لحظة UTC لبداية/نهاية اليوم
const dayStart = (key: string) => new Date(`${key}T00:00:00+03:00`);
const dayEnd = (key: string) => new Date(`${key}T23:59:59.999+03:00`);

export async function computeAchievements(agentId: number | null, fromKey: string | null, toKey: string | null): Promise<Achievements> {
  const period = fromKey && toKey ? { from: fromKey, to: toKey } : await currentSalaryPeriod(agentId);
  const where = {
    agentId: agentId ?? -1,
    ...(period ? { completedAt: { gte: dayStart(period.from), lte: dayEnd(period.to) } } : {}),
  };

  const comps = await prisma.cardCompletion.findMany({
    where,
    select: { technicianId: true, kind: true, durationSec: true, towerId: true },
  });
  if (!comps.length) {
    return {
      from: period?.from ?? null, to: period?.to ?? null,
      rows: [], leader: null, kindAvg: [], byOffice: [], totals: { total: 0, kinds: [] },
      weights: KIND_WEIGHTS, defaultWeight: DEFAULT_WEIGHT, minCards: MIN_CARDS_FOR_CROWN,
    };
  }

  // متوسط زمن كل فئة عبر **كل الفنيين** — هو المرجع الذي تُقاس عليه سرعة كلٍّ منهم
  const kindTimes = new Map<string, number[]>();
  for (const c of comps) {
    const d = c.durationSec ?? 0;
    if (d > 0 && d <= MAX_VALID_SEC) {
      const k = norm(c.kind) || "—";
      const arr = kindTimes.get(k) ?? [];
      arr.push(d);
      kindTimes.set(k, arr);
    }
  }
  const kindAvgSec = new Map<string, number>();
  for (const [k, arr] of kindTimes) kindAvgSec.set(k, arr.reduce((s, v) => s + v, 0) / arr.length);

  // أسماء الفنيين ومكاتبهم
  const techIds = [...new Set(comps.map((c) => c.technicianId))];
  const techs = await prisma.technician.findMany({ where: { id: { in: techIds } }, select: { id: true, name: true, towerId: true } });
  const towerIds = [...new Set([...techs.map((t) => t.towerId), ...comps.map((c) => c.towerId)].filter((x): x is number => x != null))];
  const towers = await prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } });
  const towerName = new Map(towers.map((t) => [t.id, t.name]));
  const techById = new Map(techs.map((t) => [t.id, t]));

  type Acc = { cards: number; points: number; timedSec: number[]; kinds: Map<string, { count: number; secs: number[] }> };
  const acc = new Map<number, Acc>();
  for (const c of comps) {
    const k = norm(c.kind) || "—";
    const weight = weightOfKind(k);
    const d = c.durationSec ?? 0;
    const valid = d > 0 && d <= MAX_VALID_SEC;
    const avg = kindAvgSec.get(k);
    // معامل السرعة: متوسط الفئة ÷ زمنه فيها. بلا زمن صالح ⇒ ١ (محايد — والتوصيل كلّه هكذا)
    const speed = valid && avg ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, avg / d)) : 1;

    const a: Acc = acc.get(c.technicianId) ?? { cards: 0, points: 0, timedSec: [] as number[], kinds: new Map() };
    a.cards += 1;
    a.points += weight * speed;
    if (valid) a.timedSec.push(d);
    const kk = a.kinds.get(k) ?? { count: 0, secs: [] };
    kk.count += 1;
    if (valid) kk.secs.push(d);
    a.kinds.set(k, kk);
    acc.set(c.technicianId, a);
  }

  const rows: TechRow[] = [...acc.entries()].map(([id, a]) => {
    const t = techById.get(id);
    const avgOf = (arr: number[]) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) / 6) / 10 : null);
    return {
      technicianId: id,
      name: t?.name ?? `فني #${id}`,
      office: t?.towerId != null ? towerName.get(t.towerId) ?? null : null,
      cards: a.cards,
      points: Math.round(a.points * 10) / 10,
      timed: a.timedSec.length,
      avgMin: avgOf(a.timedSec),
      byKind: [...a.kinds.entries()]
        .map(([kind, v]) => ({ kind, count: v.count, avgMin: avgOf(v.secs), weight: weightOfKind(kind) }))
        .sort((x, y) => y.weight - x.weight || y.count - x.count),
    };
  });

  // الترتيب: النقاط ثم عدد البطاقات
  rows.sort((a, b) => b.points - a.points || b.cards - a.cards);
  const leader = rows.find((r) => r.cards >= MIN_CARDS_FOR_CROWN) ?? null;

  // ===== حصاد كل مكتب + المجموع الكلي (طلب محمد 2026-08-05) =====
  // الفئة تُعدّ حيث **أُنجز العمل** (towerId على قيد الإنجاز) لا حيث يسكن الفني —
  // فالفنيّ المُعار يُحسب إنجازه للمكتب الذي خدمه.
  const officeMap = new Map<number, Map<string, number>>();
  const totalKinds = new Map<string, number>();
  for (const c of comps) {
    const k = norm(c.kind) || "—";
    const key = c.towerId ?? -1;
    const m = officeMap.get(key) ?? new Map<string, number>();
    m.set(k, (m.get(k) ?? 0) + 1);
    officeMap.set(key, m);
    totalKinds.set(k, (totalKinds.get(k) ?? 0) + 1);
  }
  const kindsSorted = (m: Map<string, number>) =>
    [...m.entries()].map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => weightOfKind(b.kind) - weightOfKind(a.kind) || b.count - a.count);
  const byOffice: OfficeTally[] = [...officeMap.entries()].map(([id, m]) => ({
    towerId: id === -1 ? null : id,
    office: id === -1 ? "بلا مكتب" : towerName.get(id) ?? ("مكتب " + id),
    total: [...m.values()].reduce((s2, v) => s2 + v, 0),
    kinds: kindsSorted(m),
  })).sort((a, b) => b.total - a.total);

  return {
    from: period?.from ?? null, to: period?.to ?? null,
    rows, leader,
    byOffice,
    totals: { total: comps.length, kinds: kindsSorted(totalKinds) },
    kindAvg: [...kindTimes.keys()].map((k) => ({
      kind: k,
      count: (kindTimes.get(k) ?? []).length,
      avgMin: Math.round(((kindAvgSec.get(k) ?? 0) / 60) * 10) / 10,
      weight: weightOfKind(k),
    })).sort((a, b) => b.weight - a.weight),
    weights: KIND_WEIGHTS, defaultWeight: DEFAULT_WEIGHT, minCards: MIN_CARDS_FOR_CROWN,
  };
}
