import { prisma } from "@/lib/prisma";
import { currentPeriodFromDays } from "@/lib/salary";
import { baghdadDayKey } from "@/lib/attendance";

// ===== إنجازات الفنيين ومسابقة الشهر (طلب محمد 2026-08-05) =====
// كان الترتيب بالعدد وحده مضلّلاً: التوصيل **نصف كل ما يُنجَز** (٢٦٧ من ٥٣٥ في فترة
// تموز) وهو أسهلها وبلا زمن أصلاً — فمن يأخذ توصيلات كثيرة يبدو الأكثر إنجازاً.
//
// القاعدة كما أملاها محمد (عُدِّلت 2026-08-07): لكل فئة **وزن صعوبة** فقط، ونقاط الفني =
// **مجموع أوزان بطاقاته** في الفترة — **بلا أيّ عامل وقت/سرعة إطلاقاً**. الزمن يبقى
// معروضاً للاطّلاع فقط (متوسط كل فئة) لا للاحتساب.
//
//   نقاط الفني = Σ وزن فئة كل بطاقة
//
// الأوزان: تنصيب/سحب ٢ · تحويل ١٫٥ · إعادة ١٫٥ · صيانة ١ · توصيل ٠٫٢٥ · أي نوع جديد ١.

// ═══════════ تحديثٌ 2026-08-13 · النقاطُ صارت بيدِ المدير لكلّ فئة ═══════════
// طلبُ محمد: «أن يقوم المديرُ بإعطاء **نقاطٍ لكلّ فئة** حسب ما يرغب، **ويمكن أن يكون
// صفراً**، لمتابعة إنجازات الفنيّين.» ⇒ نُقض قرارُه السابق («ثابتةٌ في الكود لا تُعدَّل
// من الشاشة») بطلبِه هو.
//
// والقيمةُ تُقرأ من `CardType.achievementWeight` **لكلّ وكيلٍ على حدة**:
//   • فارغٌ (`null`) ⇒ الوزنُ المبنيُّ أدناه — **فلا يتغيّر شيءٌ على وكيلٍ لم يُعدِّل**
//   • `0`          ⇒ الفئةُ **لا تُحتسَب** إطلاقاً (قرارٌ صريح)
// ⚠️ ولذلك يُفحَص **الوجودُ** لا الصدق: `has(k)` لا `custom.get(k) || fallback` — وإلّا
// انقلب الصفرُ إلى الوزن الافتراضيّ فصار «صفّرتُها» يعني «أعطيتُها الافتراضيّ».
// والأوزانُ أدناه تبقى **الأساسَ والمرجعَ**: هي ما يُعرَض للمدير كقيمةٍ حاليّةٍ قبل تعديله.

// أوزان الصعوبة المبنيّة — الأساسُ حين لا يُحدِّد المديرُ شيئاً
export const KIND_WEIGHTS: { label: string; weight: number }[] = [
  { label: "تنصيب", weight: 2 },
  { label: "سحب جديد", weight: 2 }, // «هو نفسه تنصيب»
  { label: "تحويل", weight: 1.5 },
  { label: "اعادة", weight: 1.5 },
  { label: "صيانة", weight: 1 },
  { label: "توصيل", weight: 0.25 },
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
  if (k.includes("تنصيب") || k.includes("سحب")) return 2;
  if (k.includes("تحويل")) return 1.5;
  if (k.includes("اعادة") || k.includes("إعادة")) return 1.5;
  if (k === "maintenance" || k.includes("صيانة")) return 1;
  if (k.includes("توصيل")) return 0.25;
  return DEFAULT_WEIGHT;
}

// ===== التوصيل خارج معادلة الوقت تماماً (تصحيح محمد 2026-08-05) =====
// بطاقة التوصيل مستثناة أصلاً من «بدء» فلا زمن لها، وما وُجد منها بزمنٍ شاذّ (٣ بطاقات
// في فترة تموز) كان يلوّث متوسط الفئة ومتوسط الفني. الآن: **لا تدخل الوقت إطلاقاً** —
// لا في المتوسطات ولا في معامل السرعة — وتُحسب في العدد بنصف نقطة ثابتة للواحدة.
export const isDeliveryKind = (kind: string | null | undefined) => (kind ?? "").includes("توصيل");

// زمنٌ يتجاوز ٤ ساعات = نسيانُ ضغط «إنجاز» غالباً لا عملٌ فعليّ — يُستبعَد من متوسط العرض
export const MAX_VALID_SEC = 4 * 3600;
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

/** أوزانُ فئات وكيلٍ بعينه كما ضبطها مديرُه — و**الوجودُ** في الخريطة هو الحُكم لا الصدق.
 *  فالمفتاحُ الموجودُ بقيمةِ صفرٍ يعني «لا تُحتسَب»، والغائبُ يعني «استعمِل المبنيَّ». */
export async function agentKindWeights(agentId: number | null): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const types = await prisma.cardType.findMany({
    where: { agentId: agentId ?? -1, isDeleted: false },
    select: { name: true, achievementWeight: true },
  });
  for (const t of types) {
    if (t.achievementWeight == null) continue; // فارغٌ ⇒ لا يتدخّل، يبقى المبنيّ
    const w = Number(t.achievementWeight);
    if (!Number.isFinite(w) || w < 0) continue; // قيمةٌ فاسدةٌ لا تُطبَّق أبداً على نقاطٍ
    m.set(norm(t.name), w);
  }
  return m;
}

export async function computeAchievements(agentId: number | null, fromKey: string | null, toKey: string | null): Promise<Achievements> {
  const period = fromKey && toKey ? { from: fromKey, to: toKey } : await currentSalaryPeriod(agentId);
  const where = {
    agentId: agentId ?? -1,
    ...(period ? { completedAt: { gte: dayStart(period.from), lte: dayEnd(period.to) } } : {}),
  };

  // أوزانُ المدير تُحمَّل مع البيانات (استعلامٌ واحدٌ لا واحدٌ لكلّ بطاقة)
  const [comps, custom] = await Promise.all([
    prisma.cardCompletion.findMany({
      where,
      select: { technicianId: true, kind: true, durationSec: true, towerId: true },
    }),
    agentKindWeights(agentId),
  ]);
  /** وزنُ الفئة الفعليُّ: ما ضبطه المديرُ إن ضبطه (ولو صفراً)، وإلّا المبنيُّ في الكود. */
  const wOf = (k: string | null | undefined): number => {
    const key = norm(k);
    return custom.has(key) ? (custom.get(key) as number) : weightOfKind(key);
  };
  // 🔴 والأسطورةُ المعروضةُ تحت الجدول تُبنى من **الفعليّ** لا من المبنيّ وحدَه: وإلّا بقيت
  // تقول «توصيل ×٠٫٢٥» بعد أن يُصفِّرها المديرُ — فيكذب الشرحُ على الحساب في نفس الشاشة.
  // فتُدمَج أوزانُه فوق المبنيّة، ويُلحَق ما ضبطه لفئةٍ ليست في القائمة المبنيّة.
  const effectiveWeights = (() => {
    const out = KIND_WEIGHTS.map((w) => ({ label: w.label, weight: wOf(w.label) }));
    const seen = new Set(out.map((w) => w.label));
    for (const [label, weight] of custom) if (!seen.has(label)) out.push({ label, weight });
    return out;
  })();
  if (!comps.length) {
    return {
      from: period?.from ?? null, to: period?.to ?? null,
      rows: [], leader: null, kindAvg: [], byOffice: [], totals: { total: 0, kinds: [] },
      weights: effectiveWeights, defaultWeight: DEFAULT_WEIGHT, minCards: MIN_CARDS_FOR_CROWN,
    };
  }

  // متوسط زمن كل فئة عبر **كل الفنيين** — هو المرجع الذي تُقاس عليه سرعة كلٍّ منهم
  const kindTimes = new Map<string, number[]>();
  for (const c of comps) {
    if (isDeliveryKind(c.kind)) continue; // التوصيل لا يدخل الوقت إطلاقاً
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
    const weight = wOf(k);
    const d = c.durationSec ?? 0;
    // الاحتساب = وزن الفئة فقط، بلا أيّ عامل سرعة (قرار محمد 2026-08-07).
    // `valid` لا يخصّ الاحتساب — يقتصر على تجميع الأزمنة الصالحة لعرض المتوسطات فقط،
    // والتوصيل مستبعَد منها (لا زمن له).
    const valid = !isDeliveryKind(k) && d > 0 && d <= MAX_VALID_SEC;

    const a: Acc = acc.get(c.technicianId) ?? { cards: 0, points: 0, timedSec: [] as number[], kinds: new Map() };
    a.cards += 1;
    a.points += weight;
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
        .map(([kind, v]) => ({ kind, count: v.count, avgMin: avgOf(v.secs), weight: wOf(kind) }))
        .sort((x, y) => y.weight - x.weight || y.count - x.count),
    };
  });

  // الترتيب: النقاط ثم عدد البطاقات
  rows.sort((a, b) => b.points - a.points || b.cards - a.cards);
  // 🔴 و`points > 0` شرطٌ **أضافه بندُ النقاط**: التتويجُ كان يشترط عددَ بطاقاتٍ وحدَه،
  // فلمّا صار المديرُ يستطيع تصفيرَ فئةٍ أمكن أن يُتوَّج فنيٌّ أنجز خمسَ بطاقاتٍ **كلُّها من
  // فئةٍ مُصفَّرة** فيظهر «👑 المتصدّر — ٠ نقطة» في الرئيسيّة. والتاجُ بلا نقطةٍ عبثٌ يُسقط
  // ثقةَ المسابقة كلِّها. (وهو الخطرُ الرابعُ من مخاطر البند الأربعة المُسجَّلة سابقاً.)
  const leader = rows.find((r) => r.cards >= MIN_CARDS_FOR_CROWN && r.points > 0) ?? null;

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
      .sort((a, b) => wOf(b.kind) - wOf(a.kind) || b.count - a.count);
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
      weight: wOf(k),
    })).sort((a, b) => b.weight - a.weight),
    // الأوزانُ **الفعليّة** لا المبنيّةُ وحدَها — وهذا هو المسارُ الذي يُعرَض دائماً (والآخرُ
    // لا يُصاب إلّا حين لا بطاقةَ في الفترة). فلو بقي مبنيّاً لبقيت الأسطورةُ تقول «توصيل
    // ×٠٫٢٥» بعد تصفيره، فيكذب الشرحُ على الحساب في نفس الشاشة.
    weights: effectiveWeights, defaultWeight: DEFAULT_WEIGHT, minCards: MIN_CARDS_FOR_CROWN,
  };
}
