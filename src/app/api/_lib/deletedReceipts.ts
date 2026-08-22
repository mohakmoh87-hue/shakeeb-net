import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { agentTowerIds } from "@/lib/guard";
import { baghdadStart, baghdadEnd } from "@/lib/dayRange";
import type { SessionPayload } from "@/lib/auth";

// ═════ 🗑️ سجلُّ الوصولات المحذوفة — المرحلةُ الأولى: قراءةٌ محضة (طلبُ محمد 2026-08-22) ═════
//
// 📌 **لماذا هنا لا في `src/lib/`**: قائمةُ `UI_ONLY` في `src/worker.ts:133` تستثني `src/app/`
//   و`src/components/` وحدَهما، فأيُّ ملفٍّ جديدٍ في `src/lib/` **يُعيد تشغيل حواسيب المكاتب**
//   وتُبنى متصفّحاتُ الواتساب من جديد. (نفسُ سببِ وجود `stampOffice.ts` هنا.)
//
// ✋ **صفرُ كتابة**: لا `update` ولا `create` ولا `delete` في هذا الملفّ ولا في مساره —
//    واختبارٌ بنيويٌّ في `tests/deleted-receipts.test.ts` يفشل إن تسلّلت كتابةٌ واحدة.
//
// 📋 **حدودُ السجلّ (إملاءُ محمد 2026-08-22)**: يدخله **الوصلُ الذي يُمسح حصراً** —
//    وصلُ تفعيلٍ · فاتورةُ مبيعٍ · قيدُ صندوقٍ (تفعيل/فاتورة/ماستر/مصروف/مقبوض) · حركةُ مدير.
//    ولا يدخله: **تسديدُ دين المشترك أو دين الفاتورة** (`debt` · `master-debt`) ولا **مسحُ
//    الدين** (لا يحذف صفّاً أصلاً) ولا **وصلُ «ديون سابقة»** (دَينٌ لا وصلٌ مقبوض).
//    وهو يرصد **الحذفَ وحدَه**: لا يظهر وصلٌ لأنّه سُجِّل، بل لأنّه مُسِح.

/** أنواعُ الوثائق الأربعة التي يرصدها السجلّ */
export type DelKind = "activation" | "invoice" | "money" | "manager";

export const DEL_KINDS: DelKind[] = ["activation", "invoice", "money", "manager"];

/** وصلُ «إضافة ديون سابقة» — يُستثنى بنصّه كما يكتبه مسارُ الإضافة */
const DEBT_CARD_TYPE = "ديون سابقة";
/** قيودُ تسديد الدين — مستثناةٌ بقرار محمد (تسديدٌ لا وصلٌ محذوف) */
const DEBT_SOURCES = ["debt", "master-debt"];

export type DeletedRow = {
  key: string;
  kind: DelKind;
  id: number;
  /** تاريخُ الوثيقة نفسِها */
  docDate: string | null;
  /** وقتُ الحذف: من سجلّ التدقيق إن وُجد، وإلّا آخرُ تعديلٍ على الصفّ (تقريبٌ صادق) */
  deletedAt: string | null;
  /** هل وقتُ الحذف مأخوذٌ من سجلّ التدقيق (دقيق) أم من آخر تعديل (تقريبيّ)؟ */
  deletedExact: boolean;
  deletedBy: string | null;
  /** كيف حُذف: عكسيّاً (بأثرٍ ماليّ) أم بلا أثر — من نصّ التدقيق */
  mode: "reverse" | "plain" | null;
  towerId: number | null;
  towerName: string | null;
  title: string;
  who: string | null;
  netUser: string | null;
  amount: number | null;
  received: number | null;
  dir: "in" | "out" | null;
  note: string | null;
};

export type DeletedQuery = {
  from?: string | null;
  to?: string | null;
  /** على أيّ تاريخٍ يقع المدى: `del` وقتُ الحذف (الافتراض) أم `doc` تاريخُ الوثيقة */
  on?: string | null;
  q?: string | null;
  tower?: string | null;
  kind?: string | null;
  limit?: string | null;
};

export type DeletedResult = {
  rows: DeletedRow[];
  counts: Record<DelKind, number>;
  towers: { id: number; name: string | null }[];
  limit: number;
  /** true إن بلغ أحدُ المصادر السقفَ فبقيت صفوفٌ خارج الصفحة */
  capped: boolean;
  /** حركاتُ المدير بلا عمود مكتب — تُستبعَد عند ترشيح مكتبٍ بعينه */
  managerHidden: boolean;
};

const MANAGER_TYPES: Record<string, string> = {
  expense: "مصروف مدير",
  receipt: "مقبوض مدير",
  salary: "راتب",
  "card-payment": "تسديد ديون كروت",
  "master-receipt": "مقبوض ماستر",
  "master-expense": "مصروف ماستر",
};

const MONEY_SOURCES: Record<string, string> = {
  activation: "مالُ وصل تفعيل",
  master: "مالُ تفعيل ماستر",
  invoice: "مالُ فاتورة",
  "master-invoice": "مالُ فاتورة ماستر",
  sale: "بيع",
  manual: "قيدٌ يدويّ",
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** «عكسياً (إرجاع)» ⇒ reverse · «بلا تأثير» ⇒ plain — كما يكتبهما مسارا الحذف حرفاً */
function modeOf(details: string | null | undefined): "reverse" | "plain" | null {
  if (!details) return null;
  if (details.includes("بلا تأثير")) return "plain";
  if (details.includes("عكس")) return "reverse";
  return null;
}

export async function listDeletedReceipts(
  session: SessionPayload | null,
  qs: DeletedQuery,
): Promise<DeletedResult> {
  const agentId = session?.agentId ?? -1;
  const towerIds = await agentTowerIds(session);

  // 🔒 عزلٌ لا خيار: مكتبٌ من مكاتب الوكيل، وإلّا مكاتبُه كلُّها. وأيُّ رقمٍ غريبٍ يسقط.
  const askTower = Number(qs.tower) || 0;
  const scope = askTower && towerIds.includes(askTower) ? [askTower] : towerIds;
  const scopeWhere = { towerId: { in: scope.length ? scope : [-1] } };

  const limit = Math.min(Math.max(Number(qs.limit) || 200, 20), 500);
  const askKind = DEL_KINDS.includes(qs.kind as DelKind) ? (qs.kind as DelKind) : null;
  const wants = (k: DelKind) => !askKind || askKind === k;

  // ⏱️ المدى: `baghdadStart/baghdadEnd` حصراً — بناءُ نهاية اليوم يدويّاً يُزيح النافذةَ
  //    ثلاثَ ساعاتٍ (ب-٨)، واختبارُ `day-range.test.ts` يمسح المسارات ويمنعه.
  const from = baghdadStart(qs.from);
  const to = baghdadEnd(qs.to);
  const range: Prisma.DateTimeFilter | undefined =
    from && to ? { gte: from, lte: to } : from ? { gte: from } : to ? { lte: to } : undefined;
  // الافتراضُ **وقتُ الحذف** — فالسؤالُ دائماً «ما الذي مُسح اليوم؟» لا «متى كُتب الوصل».
  // ووقتُ الحذف يُقاس بـ`updatedAt` لأنّ الحذفَ آخرُ كتابةٍ على الصفّ، ويُصحَّح بالعرض
  // من سجلّ التدقيق حين يوجد.
  const onDoc = qs.on === "doc";
  const dateWhere = (docField: "date"): Record<string, Prisma.DateTimeFilter | undefined> =>
    range ? (onDoc ? { [docField]: range } : { updatedAt: range }) : {};

  const q = (qs.q ?? "").trim();
  const qNum = /^\d+$/.test(q) ? Number(q) : null;

  // بحثُ المشترك: تُجلب معرّفاتُه **ضمن نطاق المكاتب** ثمّ تُستعمل في OR — نمطُ المستودع.
  let subIds: number[] = [];
  if (q) {
    const subs = await prisma.subscriber.findMany({
      where: {
        ...scopeWhere,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { netUser: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    subIds = subs.map((s) => s.id);
  }

  // ⚠️ استثناءُ وصل الدين يُكتب OR-صريحاً لا `NOT`: العمودُ يقبل NULL، و`NOT (cardType = X)`
  //    على قيمةٍ فارغةٍ يُنتج NULL فيُسقط الصفَّ — أي **تختفي وصولاتُ تفعيلٍ بلا نوعِ كارت**.
  const entryWhere: Prisma.SubscriptionEntryWhereInput = {
    isDeleted: true,
    ...scopeWhere,
    ...dateWhere("date"),
    AND: [
      { OR: [{ cardType: null }, { cardType: { not: DEBT_CARD_TYPE } }] },
      ...(q
        ? [
            {
              OR: [
                { notes: { contains: q, mode: "insensitive" as const } },
                { cardType: { contains: q, mode: "insensitive" as const } },
                { card2: { contains: q } },
                { createdByUser: { contains: q, mode: "insensitive" as const } },
                ...(subIds.length ? [{ subscriberId: { in: subIds } }] : []),
                ...(qNum ? [{ id: qNum }] : []),
              ],
            },
          ]
        : []),
    ],
  };

  const invoiceWhere: Prisma.InvoiceWhereInput = {
    isDeleted: true,
    ...scopeWhere,
    ...dateWhere("date"),
    ...(q
      ? {
          OR: [
            { note: { contains: q, mode: "insensitive" } },
            { user: { contains: q, mode: "insensitive" } },
            { type: { contains: q, mode: "insensitive" } },
            ...(subIds.length ? [{ subscriberId: { in: subIds } }] : []),
            ...(qNum ? [{ number: qNum }, { id: qNum }] : []),
          ],
        }
      : {}),
  };

  // ⚠️ استثناءُ التسديد يُكتب OR-صريحاً لا `notIn`: العمودُ يقبل NULL، و`NULL NOT IN (…)`
  //    يُسقط القيودَ اليدويّة (المصروف والمقبوض) وهي **مطلوبةٌ** في السجلّ بقرار محمد.
  const moneyWhere: Prisma.MoneyTxWhereInput = {
    isDeleted: true,
    ...scopeWhere,
    ...dateWhere("date"),
    AND: [
      { OR: [{ sourceType: null }, { sourceType: { notIn: DEBT_SOURCES } }] },
      ...(q
        ? [
            {
              OR: [
                { notes: { contains: q, mode: "insensitive" as const } },
                { pc: { contains: q, mode: "insensitive" as const } },
                ...(qNum ? [{ id: qNum }, { sourceId: qNum }] : []),
              ],
            },
          ]
        : []),
    ],
  };

  // حركةُ المدير بلا عمود مكتبٍ إطلاقاً ⇒ عزلُها بالوكيل، وتُستبعَد عند ترشيح مكتبٍ بعينه.
  const managerHidden = askTower > 0;
  const managerWhere: Prisma.ManagerTxWhereInput = {
    isDeleted: true,
    agentId,
    ...dateWhere("date"),
    ...(q
      ? {
          OR: [
            { notes: { contains: q, mode: "insensitive" } },
            { byUser: { contains: q, mode: "insensitive" } },
            { type: { contains: q, mode: "insensitive" } },
            ...(qNum ? [{ id: qNum }] : []),
          ],
        }
      : {}),
  };

  const order = onDoc
    ? ({ date: "desc" } as const)
    : ({ updatedAt: "desc" } as const);

  const [entries, invoices, monies, managers, cEntry, cInv, cMoney, cMgr, towers] = await Promise.all([
    wants("activation") ? prisma.subscriptionEntry.findMany({ where: entryWhere, orderBy: order, take: limit }) : [],
    wants("invoice") ? prisma.invoice.findMany({ where: invoiceWhere, orderBy: order, take: limit }) : [],
    wants("money") ? prisma.moneyTx.findMany({ where: moneyWhere, orderBy: order, take: limit }) : [],
    wants("manager") && !managerHidden ? prisma.managerTx.findMany({ where: managerWhere, orderBy: order, take: limit }) : [],
    prisma.subscriptionEntry.count({ where: entryWhere }),
    prisma.invoice.count({ where: invoiceWhere }),
    prisma.moneyTx.count({ where: moneyWhere }),
    managerHidden ? 0 : prisma.managerTx.count({ where: managerWhere }),
    prisma.tower.findMany({ where: { id: { in: towerIds.length ? towerIds : [-1] } }, select: { id: true, name: true }, orderBy: { id: "asc" } }),
  ]);

  // ===== الإثراء: أسماءُ المكاتب والمشتركين، ثمّ «مَن حذف ومتى وكيف» من سجلّ التدقيق =====
  const subNeeded = [
    ...entries.map((e) => e.subscriberId),
    ...invoices.map((i) => i.subscriberId),
  ].filter((x): x is number => typeof x === "number");
  const subs = subNeeded.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subNeeded } }, select: { id: true, name: true, netUser: true } })
    : [];
  const subMap = new Map(subs.map((s) => [s.id, s]));
  const towerMap = new Map(towers.map((t) => [t.id, t.name]));

  // وصلٌ حُذف **من شاشة الصندوق** لا يحمل قيدَ `VOID_RECEIPT` خاصّاً به؛ أثرُه في
  // `VOID_MONEY` على حركته. فتُجلب حركاتُ تلك الوصولات ليُوصَل كلُّ وصلٍ بقيده.
  const entryIds = entries.map((e) => e.id);
  const viaMoney = entryIds.length
    ? await prisma.moneyTx.findMany({
        where: { ...scopeWhere, sourceType: "activation", sourceId: { in: entryIds } },
        select: { id: true, sourceId: true },
      })
    : [];
  const txOfEntry = new Map<number, number>();
  for (const t of viaMoney) if (t.sourceId != null) txOfEntry.set(t.sourceId, t.id);

  const moneyAuditIds = [
    ...monies.map((m) => String(m.id)),
    ...viaMoney.map((t) => String(t.id)),
  ];
  const auditOr: Prisma.AuditLogWhereInput[] = [];
  if (entryIds.length) auditOr.push({ action: "VOID_RECEIPT", entity: "subscriptionEntry", entityId: { in: entryIds.map(String) } });
  if (invoices.length) auditOr.push({ action: "VOID_RECEIPT", entity: "invoice", entityId: { in: invoices.map((i) => String(i.id)) } });
  if (moneyAuditIds.length) auditOr.push({ action: "VOID_MONEY", entity: "moneyTx", entityId: { in: moneyAuditIds } });

  const audits = auditOr.length
    ? await prisma.auditLog.findMany({
        where: { OR: auditOr },
        orderBy: { id: "desc" },
        include: { user: { select: { fullName: true, username: true } } },
      })
    : [];
  type AuditHit = { at: Date; by: string | null; mode: "reverse" | "plain" | null };
  const auditMap = new Map<string, AuditHit>();
  for (const a of audits) {
    const k = `${a.entity}:${a.entityId}`;
    if (auditMap.has(k)) continue; // الأحدثُ أوّلاً (ترتيبٌ تنازليّ) فيبقى آخرُ حذف
    auditMap.set(k, {
      at: a.createdAt,
      by: a.user?.fullName ?? a.user?.username ?? null,
      mode: modeOf(a.details),
    });
  }

  const rows: DeletedRow[] = [];

  for (const e of entries) {
    const s = e.subscriberId != null ? subMap.get(e.subscriberId) : undefined;
    const hit =
      auditMap.get(`subscriptionEntry:${e.id}`) ??
      (txOfEntry.has(e.id) ? auditMap.get(`moneyTx:${txOfEntry.get(e.id)}`) : undefined);
    rows.push({
      key: `activation:${e.id}`,
      kind: "activation",
      id: e.id,
      docDate: iso(e.date),
      deletedAt: iso(hit?.at ?? e.updatedAt),
      deletedExact: !!hit,
      deletedBy: hit?.by ?? null,
      mode: hit?.mode ?? null,
      towerId: e.towerId ?? null,
      towerName: e.towerId != null ? towerMap.get(e.towerId) ?? null : null,
      title: e.isMaster ? "وصل تفعيل (ماستر)" : "وصل تفعيل",
      who: s?.name ?? (e.subscriberId != null ? `مشترك #${e.subscriberId}` : null),
      netUser: s?.netUser ?? null,
      amount: e.money ?? null,
      received: e.moneyIn ?? null,
      dir: "in",
      note: [e.cardType, e.card2, e.notes].filter(Boolean).join(" · ") || null,
    });
  }

  for (const i of invoices) {
    const s = i.subscriberId != null ? subMap.get(i.subscriberId) : undefined;
    const hit = auditMap.get(`invoice:${i.id}`);
    rows.push({
      key: `invoice:${i.id}`,
      kind: "invoice",
      id: i.id,
      docDate: iso(i.date),
      deletedAt: iso(hit?.at ?? i.updatedAt),
      deletedExact: !!hit,
      deletedBy: hit?.by ?? null,
      mode: hit?.mode ?? null,
      towerId: i.towerId ?? null,
      towerName: i.towerId != null ? towerMap.get(i.towerId) ?? null : null,
      title: `فاتورة مبيع${i.number != null ? ` #${i.number}` : ""}`,
      who: s?.name ?? i.user ?? null,
      netUser: s?.netUser ?? null,
      amount: i.totalMy ?? null,
      received: i.waselHim ?? null,
      dir: "in",
      note: [i.type, i.note].filter(Boolean).join(" · ") || null,
    });
  }

  for (const m of monies) {
    const hit = auditMap.get(`moneyTx:${m.id}`);
    const src = m.sourceType ?? "";
    const inAmount = m.moneyIn ?? 0;
    rows.push({
      key: `money:${m.id}`,
      kind: "money",
      id: m.id,
      docDate: iso(m.date),
      deletedAt: iso(hit?.at ?? m.updatedAt),
      deletedExact: !!hit,
      deletedBy: hit?.by ?? null,
      mode: hit?.mode ?? null,
      towerId: m.towerId ?? null,
      towerName: m.towerId != null ? towerMap.get(m.towerId) ?? null : null,
      title: "قيد صندوق",
      who: (MONEY_SOURCES[src] ?? (inAmount > 0 ? "مقبوض" : "مصروف")) + (m.sourceId != null && MONEY_SOURCES[src] ? ` #${m.sourceId}` : ""),
      netUser: null,
      amount: inAmount > 0 ? inAmount : m.moneyOut ?? 0,
      received: null,
      dir: inAmount > 0 ? "in" : "out",
      note: m.notes ?? null,
    });
  }

  for (const g of managers) {
    rows.push({
      key: `manager:${g.id}`,
      kind: "manager",
      id: g.id,
      docDate: iso(g.date),
      deletedAt: iso(g.updatedAt),
      deletedExact: false, // حذفُ حركة المدير لا يكتب سطرَ تدقيقٍ اليوم
      deletedBy: null,
      mode: null,
      towerId: null,
      towerName: null,
      title: "حركة مدير",
      who: MANAGER_TYPES[g.type] ?? g.type,
      netUser: null,
      amount: g.amount,
      received: null,
      dir: g.type === "receipt" || g.type === "master-receipt" ? "in" : "out",
      note: [g.notes, g.byUser].filter(Boolean).join(" · ") || null,
    });
  }

  const sortKey = (r: DeletedRow) => (onDoc ? r.docDate : r.deletedAt) ?? "";
  rows.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));

  const counts: Record<DelKind, number> = {
    activation: cEntry,
    invoice: cInv,
    money: cMoney,
    manager: cMgr,
  };
  const capped =
    entries.length >= limit || invoices.length >= limit || monies.length >= limit || managers.length >= limit;

  return { rows: rows.slice(0, limit), counts, towers, limit, capped, managerHidden };
}
