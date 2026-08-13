import { NextResponse } from "next/server";
import { notMaster, onlyMaster, otherIncomeOnly } from "@/lib/moneyKinds";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { iraqTodayRange, reportUserScope } from "@/lib/dailyReport";
import { subjectsForTxs } from "@/app/api/_lib/txSubjects";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// ===== «الضغط على المبلغ يفتح مكوّناته» — أسطر التقرير اليومي (المرحلة ٥) =====
// كل سطر في بطاقة التقرير كان رقماً جامداً لا سبيل لمعرفة مِمَّ تكوّن. هذا المسار
// يُرجع الحركات الفعلية وراء كل سطر ليوم العراق الحالي وللمكتب المعروض.
// الأنواع تطابق تعريفات computeDailyReport حرفاً بحرف كي لا يختلف المجموع عن التفصيل.
const KINDS = ["activation", "invoice", "sale", "other", "expenses", "master", "total"] as const;
type Kind = (typeof KINDS)[number];

// شكلُ السطر المُرجَع — واحدٌ لكلّ الأصناف كي يعرضها جدولٌ واحد
type Row = {
  id: number; date: Date | null; moneyIn: number; moneyOut: number;
  notes: string | null; office: string | null; account: string | null; by: string | null;
  sourceType: string | null;
  subject: { name: string | null; netUser: string | null; subscriberId: number | null } | null;
  /** تفصيلةٌ دقيقةٌ خاصّةٌ بالصنف (سعرُ التفعيل والمرحَّل · رقمُ الفاتورة وإجماليها) */
  detail?: string | null;
  /** معرّفُ حركة الصندوق التي تُحذَف بها — فارغٌ يعني لا مالَ في الصندوق فلا شيءَ يُحذَف */
  voidId?: number | null;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (!can(session, "finance.view") && !can(session, "finance.manage")) {
    return NextResponse.json({ error: "ليس لديك صلاحية" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const kind = (sp.get("kind") ?? "total") as Kind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "نوع غير معروف" }, { status: 400 });

  // نطاق المكتب: نفس منطق /api/reports/daily — ومَن بلا مكتب يُقيَّد بمكاتب وكيله
  const agentTowers = await agentTowerIds(session);
  const param = sp.get("towerId");
  let towerWhere: object;
  if (session.isAdmin) {
    if (!param || param === "all") towerWhere = { towerId: { in: agentTowers.length ? agentTowers : [-1] } };
    else {
      const t = Number(param) || -1;
      towerWhere = { towerId: agentTowers.includes(t) ? t : -1 };
    }
  } else {
    towerWhere = session.towerId != null
      ? { towerId: session.towerId }
      : { towerId: { in: agentTowers.length ? agentTowers : [-1] } };
  }

  // فلتر المستخدم (تقارير المكاتب متعدّدة المستخدمين): المدير يختاره (بتحقّق من وكيله)،
  // ومستخدم مكتبٍ فيه مستخدمان+ يُجبَر على حركاته هو وحده
  let userWhere: object = {};
  if (session.isAdmin) {
    const uParam = Number(sp.get("userId")) || 0;
    if (uParam > 0) {
      const u = await prisma.user.findFirst({ where: { id: uParam, agentId: session.agentId ?? -1, isDeleted: false }, select: { id: true } });
      if (u) userWhere = { userId: u.id };
    }
  } else {
    const forced = await reportUserScope(session);
    if (forced != null) userWhere = { userId: forced };
  }

  // أ-٦ · يومٌ سابق: بلا هذا كانت نافذةُ يومٍ ماضٍ تُفتح **بسطورِ اليوم** فيختلف التفصيلُ عن
  // المجموع — وهو أسوأُ من ألّا يُفتح شيء. والعزلُ محسوبٌ أعلاه ولا يتأثّر بالتاريخ.
  const dayParam = sp.get("day");
  const dayDate = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
    ? new Date(`${dayParam}T12:00:00+03:00`)
    : undefined;
  const { start, end } = iraqTodayRange(dayDate && !isNaN(dayDate.getTime()) ? dayDate : undefined);
  const dateWhere = { date: { gte: start, lte: end } };
  const base = { isDeleted: false, ...dateWhere, ...towerWhere, ...userWhere };

  const towers = await prisma.tower.findMany({
    where: { id: { in: agentTowers.length ? agentTowers : [-1] } }, select: { id: true, name: true },
  });
  const officeName = new Map(towers.map((t) => [t.id, t.name ?? `مكتب ${t.id}`]));
  const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-US");

  // أسماءُ المستخدمين والحسابات — تُطلب مرّةً بعد بناء السطور
  async function decorate(userIds: (number | null)[], accIds: (number | null)[]) {
    const uIds = [...new Set(userIds.filter((x): x is number => x != null))];
    const aIds = [...new Set(accIds.filter((x): x is number => x != null))];
    const [users, accounts] = await Promise.all([
      uIds.length ? prisma.user.findMany({ where: { id: { in: uIds } }, select: { id: true, fullName: true, username: true } }) : Promise.resolve([]),
      aIds.length ? prisma.account.findMany({ where: { id: { in: aIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const un = new Map(users.map((u) => [u.id, u.fullName ?? u.username]));
    const an = new Map(accounts.map((a) => [a.id, a.name]));
    return { un, an };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // «التفعيلاتُ كلُّ مشتركٍ وأمامه تفعيلُه بتفاصيلَ دقيقة» (طلب محمد 2026-08-13)
  // ══════════════════════════════════════════════════════════════════════════════
  // 🔴 ولماذا لا تُقرأ حركاتُ الصندوق هنا: مربّعُ «تفعيل اشتراكات» يَعُدُّ **قيودَ التفعيل**
  // (`subscription_entries`) لا حركاتِ الصندوق — والفرقُ **مقيسٌ على الإنتاج (2026-08-13)**:
  // ١٢٣ قيداً مقابل ١٢٠ حركة. والثلاثةُ الفارقةُ تفعيلاتٌ **واصلُها صفر** فُعِّلت على الدَّين
  // (٤٥ و٧٠ ألفاً مرحَّلاً)، فلا مالَ دخل الصندوق ⇒ لا حركةَ له. والمحاسبةُ صحيحةٌ تماماً،
  // لكنّ العرضَ كان يكذب: مربّعٌ يقول ١٢٣ يفتح قائمةً بـ١٢٠. وهو عينُ ما يُحذّر منه
  // `moneyKinds.ts`: «رقمٌ يختلف عن رقمٍ حسب الشاشة». فيُفصَّل **التفعيلُ نفسُه**، ويظهر
  // فيه المُفعَّلُ على الدَّين بوضوحٍ — وهو أنفعُ ما يُرى لا نقصٌ يُخفى.
  // والحذفُ يبقى **على حركة الصندوق حصراً** (`voidId`): فتفعيلٌ بلا مالٍ لا زرَّ حذفٍ له،
  // ولا يُمرَّر معرّفُ قيدٍ إلى مسار حذفِ المال أبداً.
  if (kind === "activation") {
    const w = { ...base, isMaster: false };
    const [entries, agg] = await Promise.all([
      prisma.subscriptionEntry.findMany({
        where: w, orderBy: { id: "desc" }, take: 500,
        select: {
          id: true, date: true, moneyIn: true, money: true, moneyCarry: true, addPrice: true,
          notes: true, towerId: true, userId: true, subscriberId: true, month: true,
        },
      }),
      prisma.subscriptionEntry.aggregate({ where: w, _count: true, _sum: { moneyIn: true } }),
    ]);
    const subIds = [...new Set(entries.map((e) => e.subscriberId).filter((x): x is number => x != null))];
    const [subs, links] = await Promise.all([
      subIds.length ? prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true } }) : Promise.resolve([]),
      entries.length
        ? prisma.moneyTx.findMany({
            where: { sourceType: "activation", sourceId: { in: entries.map((e) => e.id) }, isDeleted: false },
            select: { id: true, sourceId: true, accountId: true },
          })
        : Promise.resolve([]),
    ]);
    const subById = new Map(subs.map((s) => [s.id, s]));
    const linkBy = new Map(links.map((l) => [l.sourceId, l]));
    const { un, an } = await decorate(entries.map((e) => e.userId), links.map((l) => l.accountId));

    const rows: Row[] = entries.map((e) => {
      const s = e.subscriberId != null ? subById.get(e.subscriberId) : undefined;
      const link = linkBy.get(e.id);
      const price = (e.money ?? 0) + (e.addPrice ?? 0);
      const bits = [
        price ? `السعر ${fmt(price)}` : null,
        (e.moneyCarry ?? 0) ? `المرحَّل ${fmt(e.moneyCarry ?? 0)}` : null,
        e.month ? `شهر ${e.month}` : null,
        // العلامةُ التي كانت مفقودةً كلَّها: تفعيلٌ بلا واصلٍ — كلُّه على الدَّين
        (e.moneyIn ?? 0) === 0 ? "⚠️ بلا واصل (على الدَّين)" : null,
      ].filter(Boolean);
      return {
        id: e.id, date: e.date, moneyIn: e.moneyIn ?? 0, moneyOut: 0,
        notes: e.notes, office: e.towerId != null ? officeName.get(e.towerId) ?? null : null,
        account: link?.accountId != null ? an.get(link.accountId) ?? null : null,
        by: e.userId != null ? un.get(e.userId) ?? null : null,
        sourceType: "activation",
        subject: s ? { name: s.name ?? null, netUser: s.netUser ?? null, subscriberId: s.id } : null,
        detail: bits.length ? bits.join(" · ") : null,
        voidId: link?.id ?? null,
      };
    });
    return NextResponse.json({
      kind, rows,
      totals: { count: agg._count, moneyIn: agg._sum.moneyIn ?? 0, moneyOut: 0, net: agg._sum.moneyIn ?? 0 },
      truncated: agg._count > rows.length,
    });
  }

  // فاتورةُ المبيع: نفسُ العلّة ونفسُ العلاج — المربّعُ يَعُدُّ **الفواتير** لا حركاتِها،
  // وفاتورةٌ واصلُها صفر (كلُّها دَينٌ) لا تُنشئ حركةَ صندوق. ويُستثنى نوعُ «ماستر»
  // تماماً كما في `computeDailyReport` كي لا يُحتسب مالُ الماستر نقداً.
  if (kind === "invoice") {
    const w = { ...base, NOT: { type: "ماستر" } };
    const [invs, agg] = await Promise.all([
      prisma.invoice.findMany({
        where: w, orderBy: { id: "desc" }, take: 500,
        select: { id: true, number: true, type: true, date: true, totalMy: true, waselHim: true, note: true, towerId: true, userId: true, subscriberId: true },
      }),
      prisma.invoice.aggregate({ where: w, _count: true, _sum: { waselHim: true } }),
    ]);
    const subIds = [...new Set(invs.map((i) => i.subscriberId).filter((x): x is number => x != null))];
    const [subs, links] = await Promise.all([
      subIds.length ? prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true } }) : Promise.resolve([]),
      invs.length
        ? prisma.moneyTx.findMany({
            where: { sourceType: { in: ["invoice", "master-invoice"] }, sourceId: { in: invs.map((i) => i.id) }, isDeleted: false },
            select: { id: true, sourceId: true, accountId: true },
          })
        : Promise.resolve([]),
    ]);
    const subById = new Map(subs.map((s) => [s.id, s]));
    const linkBy = new Map(links.map((l) => [l.sourceId, l]));
    const { un, an } = await decorate(invs.map((i) => i.userId), links.map((l) => l.accountId));

    const rows: Row[] = invs.map((i) => {
      const s = i.subscriberId != null ? subById.get(i.subscriberId) : undefined;
      const link = linkBy.get(i.id);
      const total = i.totalMy ?? 0, wasel = i.waselHim ?? 0;
      const bits = [
        `فاتورة #${i.number ?? i.id}`,
        i.type ? String(i.type) : null,
        total ? `الإجمالي ${fmt(total)}` : null,
        total - wasel > 0 ? `⚠️ متبقٍّ ${fmt(total - wasel)} دَيناً` : null,
      ].filter(Boolean);
      return {
        id: i.id, date: i.date, moneyIn: wasel, moneyOut: 0,
        notes: i.note, office: i.towerId != null ? officeName.get(i.towerId) ?? null : null,
        account: link?.accountId != null ? an.get(link.accountId) ?? null : null,
        by: i.userId != null ? un.get(i.userId) ?? null : null,
        sourceType: "invoice",
        subject: s ? { name: s.name ?? null, netUser: s.netUser ?? null, subscriberId: s.id } : null,
        detail: bits.join(" · "),
        voidId: link?.id ?? null,
      };
    });
    return NextResponse.json({
      kind, rows,
      totals: { count: agg._count, moneyIn: agg._sum.waselHim ?? 0, moneyOut: 0, net: agg._sum.waselHim ?? 0 },
      truncated: agg._count > rows.length,
    });
  }

  // ══════════ بقيّةُ الأصناف: مصدرُها الصندوقُ أصلاً فتُقرأ منه كما كانت ══════════
  // «المقبوضات (اليوم)» = ما ليس تفعيلاً ولا فاتورة ولا بيع مخزن ولا ماستر:
  // تسديدات الديون والحركات اليدوية. والتعريفاتُ من مصدرٍ واحد — لا تُكتب يدوياً هنا.
  const whereByKind: Record<Exclude<Kind, "activation" | "invoice">, object> = {
    sale: { ...base, sourceType: "sale" },
    other: { ...base, ...otherIncomeOnly },
    expenses: { ...base, moneyOut: { gt: 0 }, ...notMaster },
    master: { ...base, ...onlyMaster },
    total: { ...base, ...notMaster },
  };

  const where = whereByKind[kind];
  const [txs, agg] = await Promise.all([
    prisma.moneyTx.findMany({
      where,
      orderBy: { id: "desc" },
      take: 500,
      select: { id: true, moneyIn: true, moneyOut: true, notes: true, date: true, towerId: true, sourceType: true, sourceId: true, accountId: true, userId: true },
    }),
    prisma.moneyTx.aggregate({ where, _sum: { moneyIn: true, moneyOut: true }, _count: true }),
  ]);

  // «من أين أتت كلُّ واحدة» (طلب محمد 2026-08-13): صاحبُ الحركة من **مفتاحه** لا من
  // نصّ الملاحظة المقتطع. والحركاتُ هنا **مُقيَّدةٌ بمكاتب الوكيل** أعلاه فلا يتأثّر العزل.
  const subjects = await subjectsForTxs(txs);
  const { un, an } = await decorate(txs.map((t) => t.userId), txs.map((t) => t.accountId));

  return NextResponse.json({
    kind,
    rows: txs.map((t) => ({
      id: t.id,
      date: t.date,
      moneyIn: t.moneyIn ?? 0,
      moneyOut: t.moneyOut ?? 0,
      notes: t.notes,
      office: t.towerId != null ? officeName.get(t.towerId) ?? null : null,
      account: t.accountId != null ? an.get(t.accountId) ?? null : null,
      by: t.userId != null ? un.get(t.userId) ?? null : null,
      sourceType: t.sourceType,
      // اليوزرُ والاسمُ معاً — والفارغُ يعني حركةً لا صاحبَ لها (سحبٌ/خصمٌ يدويّ)
      subject: subjects.get(t.id) ?? null,
      detail: null,
      voidId: t.id, // هذه حركةُ صندوقٍ بذاتها فتُحذَف بمعرّفها
    })),
    totals: {
      count: agg._count,
      moneyIn: agg._sum.moneyIn ?? 0,
      moneyOut: agg._sum.moneyOut ?? 0,
      net: (agg._sum.moneyIn ?? 0) - (agg._sum.moneyOut ?? 0),
    },
    truncated: agg._count > txs.length,
  });
}
