import { prisma } from "@/lib/prisma";

// ═════ 🔁🧰 سجلُّ «الترحيلات والذمم» — طلبُ محمد 2026-11-01 ═════
//
// 🔴 ما كان: الترحيلُ بين المكاتب يُنقص مخزناً ويزيد آخرَ **بلا سطرٍ واحدٍ** في أيّ جدول،
//   والذمّةُ تحفظ الرصيدَ القائم وحدَه (`custodies.qty`) لا حركةَ التسليم والاستلام. فسؤالُ
//   «متى رُحّلت هذه المادّة ومن سلّمها لمن» لم يكن له جوابٌ في القاعدة.
//
// 🔑 والقيدُ في `audit_logs` بوسمٍ آليِّ القراءة لا في جدولٍ جديد — بنفسِ حُجّة
//   `itemBatchLog.ts`: لا لصقةَ SQL على الإنتاج، والتاريخُ القديم يظهر فوراً.
//
// ⚖️ **ولا عدَّ مزدوجاً:** مبيعُ بطاقةِ الصيانة يُنقص المخزنَ وذمّةَ الفنيّ معاً، وله صفٌّ
//   في `sale_consumptions` كأيّ بيع. فالفيصلُ **وصفُ فاتورته** («تكت #N»): ما كان منها
//   صرفُ ذمّةٍ (`CARD_USE`) وما سواه بيعٌ من المخزن (`SELL`) — لا صفَّ في الاثنين.

export type MoveKind =
  | "TRANSFER" | "SUPPORT" | "GIVE" | "RETURN" | "CARD_USE" | "QTY_UP" | "QTY_DOWN" | "BUY" | "SELL" | "HELD";

export const MOVE_LABEL: Record<MoveKind, string> = {
  HELD: "ذمّةٌ قائمةٌ بيد الفنيّ",
  TRANSFER: "ترحيل بين مكتبين",
  SUPPORT: "ترحيل ذمّة (انتهاء دعم)",
  GIVE: "تسليم ذمّة لفنيّ",
  RETURN: "استلام ذمّة من فنيّ",
  CARD_USE: "صرف ذمّة على بطاقة",
  QTY_UP: "زيادة كميّة (تصحيح)",
  QTY_DOWN: "إنقاص كميّة (تصحيح)",
  BUY: "دفعة شراء",
  SELL: "بيع من المخزن",
};

const TAG_RE = /⟦mv:([A-Z_]+)((?:\|[a-z]+:-?\d+(?:\.\d+)?)*)⟧/;

/** وسمٌ آليُّ القراءة يُلحَق بنصّ الأثر — بمحدِّداتٍ لا ترد في أسماء الناس ولا المواد. */
export function moveTag(p: {
  kind: "TRANSFER" | "GIVE" | "RETURN";
  itemId: number;
  qty: number;
  fromTower?: number | null;
  toTower?: number | null;
  techId?: number | null;
  cost?: number | null;
}): string {
  const parts = [`it:${p.itemId}`, `q:${p.qty}`];
  if (p.fromTower != null) parts.push(`from:${p.fromTower}`);
  if (p.toTower != null) parts.push(`to:${p.toTower}`);
  if (p.techId != null) parts.push(`tech:${p.techId}`);
  if (p.cost != null && Number.isFinite(p.cost) && p.cost > 0) parts.push(`cost:${Math.round(p.cost)}`);
  return ` ⟦mv:${p.kind}|${parts.join("|")}⟧`;
}

export function parseMoveTag(details: string | null | undefined): {
  kind: string; itemId: number | null; qty: number; fromTower: number | null;
  toTower: number | null; techId: number | null; cost: number | null;
} | null {
  const m = TAG_RE.exec(details ?? "");
  if (!m) return null;
  const f = new Map<string, number>();
  for (const seg of (m[2] ?? "").split("|")) {
    const kv = /^([a-z]+):(-?\d+(?:\.\d+)?)$/.exec(seg);
    if (kv) f.set(kv[1], Number(kv[2]));
  }
  return {
    kind: m[1],
    itemId: f.get("it") ?? null,
    qty: f.get("q") ?? 0,
    fromTower: f.get("from") ?? null,
    toTower: f.get("to") ?? null,
    techId: f.get("tech") ?? null,
    cost: f.get("cost") ?? null,
  };
}

const QTY_TAG_RE = /⟦q:(-?\d+(?:\.\d+)?)→(-?\d+(?:\.\d+)?)(?:\|buy:(-?\d+(?:\.\d+)?))?⟧/;
const SUPPORT_RE = /ترحيل «(.+?)»×(-?\d+(?:\.\d+)?) من مكتب الدعم \((\d+)\) إلى مخزن مكتبه \((\d+)\)/;
const CARD_RE = /تكت #(\d+)/;

export type MoveRow = {
  key: string;
  at: string;
  kind: MoveKind;
  /** قيدٌ كُتب لحظةَ الحركة (مُسجَّل) أم مستنتَجٌ من أثرٍ آخر (مشتَقّ) */
  recorded: boolean;
  /** الحركةُ أُلغيت لاحقاً (فاتورةٌ ملغاةٌ أو وصلٌ محذوف) */
  voided: boolean;
  itemId: number | null;
  itemName: string;
  qty: number;
  fromTowerId: number | null;
  toTowerId: number | null;
  technicianId: number | null;
  technicianName: string | null;
  unitCost: number | null;
  total: number | null;
  user: string | null;
  note: string;
};

export type MoveQuery = {
  /** المكاتبُ المسموحةُ — **العزلُ مسؤوليّةُ النداء**: تُحسَب من الجلسة قبل الدخول هنا */
  offices: number[];
  agentId: number;
  from?: Date | null;
  to?: Date | null;
  officeId?: number | null;
  techId?: number | null;
  itemId?: number | null;
  kinds?: MoveKind[] | null;
  q?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minQty?: number | null;
  maxQty?: number | null;
  /** الكلفةُ للمدير وحدَه — كخانة «الكلفة» في المخزن */
  showCost: boolean;
  take: number;
};

const SRC_CAP = 3000;

const arNorm = (s: string) =>
  s.replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/\s+/g, " ").trim().toLowerCase();

export async function readInventoryMoves(qy: MoveQuery): Promise<{ rows: MoveRow[]; truncated: boolean }> {
  const offices = qy.officeId != null && qy.offices.includes(qy.officeId) ? [qy.officeId] : qy.offices;
  if (!offices.length) return { rows: [], truncated: false };

  // 🧰 «الذمّةُ القائمة» رصيدٌ لا حركة، فلا تُخلَط بـ«كلّ الحركات» ولا يحكمها مدى التاريخ —
  //    تُطلَب صراحةً وحدَها (تبويبُ الذمم)، وإلّا بدا الرصيدُ حركةً بتاريخِ آخرِ تغييره.
  const want = (k: MoveKind) =>
    k === "HELD" ? !!qy.kinds?.includes("HELD") : (!qy.kinds?.length || qy.kinds.includes(k));
  const range = (field: string) => {
    const r: Record<string, Date> = {};
    if (qy.from) r.gte = qy.from;
    if (qy.to) r.lte = qy.to;
    return Object.keys(r).length ? { [field]: r } : {};
  };

  const actions: string[] = [];
  if (want("TRANSFER")) actions.push("INV_TRANSFER");
  if (want("GIVE")) actions.push("CUSTODY_GIVE");
  if (want("RETURN")) actions.push("CUSTODY_RETURN");
  if (want("SUPPORT")) actions.push("SUPPORT_CUSTODY_TRANSFER");
  if (want("QTY_UP")) actions.push("ITEM_QTY_UP");
  if (want("QTY_DOWN")) actions.push("ITEM_QTY_DOWN");

  const [audits, batches, sales, held] = await Promise.all([
    actions.length
      ? prisma.auditLog.findMany({
          where: { action: { in: actions }, ...range("createdAt") },
          orderBy: { id: "desc" }, take: SRC_CAP,
          select: {
            id: true, action: true, entityId: true, details: true, createdAt: true,
            user: { select: { fullName: true, username: true } },
          },
        }).catch(() => [])
      : [],
    want("BUY")
      ? prisma.itemBatch.findMany({
          where: { agentId: qy.agentId, towerId: { in: offices }, ...range("date") },
          orderBy: { id: "desc" }, take: SRC_CAP,
          select: { id: true, itemId: true, towerId: true, qty: true, buyPrice: true, date: true, receiptId: true, isDeleted: true },
        }).catch(() => [])
      : [],
    want("SELL") || want("CARD_USE")
      ? prisma.saleConsumption.findMany({
          where: { agentId: qy.agentId, towerId: { in: offices }, ...range("at") },
          orderBy: { id: "desc" }, take: SRC_CAP,
          select: { id: true, itemId: true, towerId: true, qty: true, unitCost: true, unitSell: true, at: true, invoiceId: true, invoiceItemId: true, isDeleted: true },
        }).catch(() => [])
      : [],
    // 🧰 ما بيد كلّ فنيٍّ الآن — مكتبُ الذمّة قد يكون فارغاً في صفوفٍ قديمة، فيُسنَد من مادّتها
    want("HELD")
      ? prisma.custody.findMany({
          where: { isDeleted: false, qty: { gt: 0 }, OR: [{ towerId: { in: offices } }, { towerId: null }] },
          orderBy: { id: "desc" }, take: SRC_CAP,
          select: { id: true, technicianId: true, itemId: true, towerId: true, qty: true, updatedAt: true },
        }).catch(() => [])
      : [],
  ]);

  const custodyIds = audits
    .filter((a) => a.action === "SUPPORT_CUSTODY_TRANSFER" && a.entityId)
    .map((a) => Number(a.entityId)).filter((n) => Number.isFinite(n));
  const invoiceIds = [...new Set(sales.map((s) => s.invoiceId).filter((n): n is number => n != null))];

  const [custodies, invoices, cardInvoices] = await Promise.all([
    custodyIds.length
      ? prisma.custody.findMany({ where: { id: { in: custodyIds } }, select: { id: true, technicianId: true, itemId: true } }).catch(() => [])
      : [],
    invoiceIds.length
      ? prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, note: true, number: true, isDeleted: true } }).catch(() => [])
      : [],
    // 🧰 صرفُ الذمّة قبل عهد FIFO (2026-09-05) لا صفَّ له في `sale_consumptions` — فيُقرأ
    //    من فاتورة الصيانة نفسِها، ويُستبعَد ما غطّاه الاستهلاكُ كي لا يُعَدَّ مرّتَين.
    want("CARD_USE")
      ? prisma.invoice.findMany({
          where: { towerId: { in: offices }, note: { contains: "تكت #" }, ...range("date") },
          orderBy: { id: "desc" }, take: SRC_CAP,
          select: { id: true, note: true, number: true, isDeleted: true, towerId: true, date: true },
        }).catch(() => [])
      : [],
  ]);
  const custodyById = new Map(custodies.map((c) => [c.id, c]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));

  const cardIds = [...new Set([...invoices, ...cardInvoices]
    .map((i) => Number(CARD_RE.exec(i.note ?? "")?.[1])).filter((n) => Number.isFinite(n)))];
  const cards = cardIds.length
    ? await prisma.taskCard.findMany({ where: { id: { in: cardIds } }, select: { id: true, technicianId: true, title: true } }).catch(() => [])
    : [];
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const covered = new Set(sales.map((s) => s.invoiceItemId));
  const legacyLines = cardInvoices.length
    ? (await prisma.invoiceItem.findMany({
        where: { invoiceId: { in: cardInvoices.map((i) => i.id) } },
        orderBy: { id: "desc" }, take: SRC_CAP,
        select: { id: true, invoiceId: true, itemId: true, count: true, price: true, isDeleted: true },
      }).catch(() => [])).filter((l) => !covered.has(l.id) && l.itemId != null)
    : [];
  const cardInvoiceById = new Map(cardInvoices.map((i) => [i.id, i]));

  const itemIds = new Set<number>();
  for (const l of legacyLines) if (l.itemId != null) itemIds.add(l.itemId);
  for (const h of held) itemIds.add(h.itemId);
  for (const b of batches) itemIds.add(b.itemId);
  for (const s of sales) itemIds.add(s.itemId);
  for (const c of custodies) itemIds.add(c.itemId);
  for (const a of audits) {
    if (a.action === "ITEM_QTY_UP" || a.action === "ITEM_QTY_DOWN") {
      const n = Number(a.entityId);
      if (Number.isFinite(n)) itemIds.add(n);
    }
    const t = parseMoveTag(a.details);
    if (t?.itemId != null) itemIds.add(t.itemId);
  }

  const [items, techs, towers] = await Promise.all([
    itemIds.size
      ? prisma.item.findMany({ where: { id: { in: [...itemIds] } }, select: { id: true, name: true, towerId: true, priceDinar: true } })
      : [],
    prisma.technician.findMany({ where: { towerId: { in: offices } }, select: { id: true, name: true, towerId: true } }).catch(() => []),
    // أسماءُ **كلّ** مكاتب النطاق لا المكتبِ المنتقى — فالطرفُ الآخر للترحيل يُسمّى أيضاً
    prisma.tower.findMany({ where: { id: { in: qy.offices } }, select: { id: true, name: true } }),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const techName = new Map(techs.map((t) => [t.id, t.name]));
  const towerName = new Map(towers.map((t) => [t.id, t.name ?? `#${t.id}`]));

  const extraTechIds = [...new Set([
    ...custodies.map((c) => c.technicianId),
    ...held.map((h) => h.technicianId),
    ...cards.map((c) => c.technicianId).filter((n): n is number => n != null),
    ...audits.map((a) => parseMoveTag(a.details)?.techId).filter((n): n is number => n != null),
  ])].filter((id) => !techName.has(id));
  if (extraTechIds.length) {
    for (const t of await prisma.technician.findMany({ where: { id: { in: extraTechIds } }, select: { id: true, name: true } }).catch(() => [])) {
      techName.set(t.id, t.name);
    }
  }

  const rows: MoveRow[] = [];
  const inScope = (...ids: (number | null)[]) => ids.some((id) => id != null && offices.includes(id));
  const userOf = (u: { fullName: string | null; username: string | null } | null) =>
    (u?.fullName ?? u?.username ?? "").trim() || null;

  for (const a of audits) {
    const item = (id: number | null) => (id != null ? itemById.get(id) : undefined);
    if (a.action === "INV_TRANSFER" || a.action === "CUSTODY_GIVE" || a.action === "CUSTODY_RETURN") {
      const t = parseMoveTag(a.details);
      if (!t) continue;
      const it = item(t.itemId);
      if (!inScope(t.fromTower, t.toTower, it?.towerId ?? null)) continue;
      const kind: MoveKind = a.action === "INV_TRANSFER" ? "TRANSFER" : a.action === "CUSTODY_GIVE" ? "GIVE" : "RETURN";
      rows.push({
        key: `a${a.id}`, at: a.createdAt.toISOString(), kind, recorded: true, voided: false,
        itemId: t.itemId, itemName: it?.name ?? (t.itemId != null ? `مادّة #${t.itemId}` : "—"),
        qty: t.qty, fromTowerId: t.fromTower, toTowerId: t.toTower,
        technicianId: t.techId, technicianName: t.techId != null ? (techName.get(t.techId) ?? `فنيّ #${t.techId}`) : null,
        unitCost: qy.showCost ? t.cost : null,
        total: qy.showCost && t.cost != null ? Math.round(t.cost * t.qty) : null,
        user: userOf(a.user), note: "",
      });
      continue;
    }
    if (a.action === "SUPPORT_CUSTODY_TRANSFER") {
      const m = SUPPORT_RE.exec(a.details ?? "");
      const cst = a.entityId ? custodyById.get(Number(a.entityId)) : undefined;
      const fromT = m ? Number(m[3]) : null;
      const toT = m ? Number(m[4]) : null;
      if (!inScope(fromT, toT)) continue;
      const it = item(cst?.itemId ?? null);
      rows.push({
        key: `a${a.id}`, at: a.createdAt.toISOString(), kind: "SUPPORT", recorded: true, voided: false,
        itemId: cst?.itemId ?? null, itemName: it?.name ?? m?.[1] ?? "—",
        qty: m ? Number(m[2]) : 0, fromTowerId: fromT, toTowerId: toT,
        technicianId: cst?.technicianId ?? null,
        technicianName: cst ? (techName.get(cst.technicianId) ?? `فنيّ #${cst.technicianId}`) : null,
        unitCost: null, total: null, user: userOf(a.user), note: "بقيت بذمّته في مكتبه",
      });
      continue;
    }
    const itemId = Number(a.entityId);
    const it = item(Number.isFinite(itemId) ? itemId : null);
    if (!it || !inScope(it.towerId)) continue;
    const g = QTY_TAG_RE.exec(a.details ?? "") ?? /من (-?\d+(?:\.\d+)?) إلى (-?\d+(?:\.\d+)?)/.exec(a.details ?? "");
    const before = Number(g?.[1] ?? 0);
    const after = Number(g?.[2] ?? 0);
    const buy = g && g.length > 3 && g[3] != null ? Number(g[3]) : null;
    const delta = Math.abs(after - before);
    rows.push({
      key: `a${a.id}`, at: a.createdAt.toISOString(),
      kind: a.action === "ITEM_QTY_UP" ? "QTY_UP" : "QTY_DOWN", recorded: true, voided: false,
      itemId: it.id, itemName: it.name ?? `مادّة #${it.id}`, qty: delta,
      fromTowerId: a.action === "ITEM_QTY_DOWN" ? it.towerId : null,
      toTowerId: a.action === "ITEM_QTY_UP" ? it.towerId : null,
      technicianId: null, technicianName: null,
      unitCost: qy.showCost ? buy : null,
      total: qy.showCost && buy != null ? Math.round(buy * delta) : null,
      user: userOf(a.user), note: `من ${before} إلى ${after}`,
    });
  }

  for (const b of batches) {
    const it = itemById.get(b.itemId);
    rows.push({
      key: `b${b.id}`, at: b.date.toISOString(), kind: "BUY", recorded: false, voided: b.isDeleted,
      itemId: b.itemId, itemName: it?.name ?? `مادّة #${b.itemId}`, qty: b.qty,
      fromTowerId: null, toTowerId: b.towerId, technicianId: null, technicianName: null,
      unitCost: qy.showCost ? Math.round(b.buyPrice) : null,
      total: qy.showCost ? Math.round(b.buyPrice * b.qty) : null,
      user: null, note: b.receiptId ? `وصل شراء #${b.receiptId}` : "دفعة افتتاحيّة",
    });
  }

  for (const s of sales) {
    const inv = s.invoiceId != null ? invoiceById.get(s.invoiceId) : undefined;
    const cardId = Number(CARD_RE.exec(inv?.note ?? "")?.[1]);
    const card = Number.isFinite(cardId) ? cardById.get(cardId) : undefined;
    const isCard = !!card || Number.isFinite(cardId);
    const kind: MoveKind = isCard ? "CARD_USE" : "SELL";
    if (!want(kind)) continue;
    const it = itemById.get(s.itemId);
    rows.push({
      key: `s${s.id}`, at: s.at.toISOString(), kind, recorded: false, voided: s.isDeleted || !!inv?.isDeleted,
      itemId: s.itemId, itemName: it?.name ?? `مادّة #${s.itemId}`, qty: s.qty,
      fromTowerId: s.towerId, toTowerId: null,
      technicianId: card?.technicianId ?? null,
      technicianName: card?.technicianId != null ? (techName.get(card.technicianId) ?? `فنيّ #${card.technicianId}`) : null,
      unitCost: qy.showCost ? Math.round(s.unitCost) : null,
      total: Math.round(s.unitSell * s.qty),
      user: null,
      note: isCard ? `بطاقة #${cardId}${card?.title ? ` «${card.title}»` : ""}` : (inv?.number ? `فاتورة #${inv.number}` : ""),
    });
  }

  for (const l of legacyLines) {
    const inv = l.invoiceId != null ? cardInvoiceById.get(l.invoiceId) : undefined;
    if (!inv || inv.towerId == null || !offices.includes(inv.towerId)) continue;
    const cardId = Number(CARD_RE.exec(inv.note ?? "")?.[1]);
    const card = Number.isFinite(cardId) ? cardById.get(cardId) : undefined;
    const it = l.itemId != null ? itemById.get(l.itemId) : undefined;
    rows.push({
      key: `l${l.id}`, at: (inv.date ?? new Date(0)).toISOString(), kind: "CARD_USE", recorded: false,
      voided: l.isDeleted || inv.isDeleted,
      itemId: l.itemId ?? null, itemName: it?.name ?? `مادّة #${l.itemId}`, qty: l.count ?? 0,
      fromTowerId: inv.towerId, toTowerId: null,
      technicianId: card?.technicianId ?? null,
      technicianName: card?.technicianId != null ? (techName.get(card.technicianId) ?? `فنيّ #${card.technicianId}`) : null,
      unitCost: null, total: Math.round((l.price ?? 0) * (l.count ?? 0)),
      user: null, note: `بطاقة #${cardId}${card?.title ? ` «${card.title}»` : ""} — قبل عهد الدفعات`,
    });
  }

  for (const h of held) {
    const it = itemById.get(h.itemId);
    const office = h.towerId ?? it?.towerId ?? null;
    if (!inScope(office)) continue;
    const cost = it?.priceDinar ?? null;
    rows.push({
      key: `h${h.id}`, at: h.updatedAt.toISOString(), kind: "HELD", recorded: true, voided: false,
      itemId: h.itemId, itemName: it?.name ?? `مادّة #${h.itemId}`, qty: h.qty,
      fromTowerId: office, toTowerId: null,
      technicianId: h.technicianId, technicianName: techName.get(h.technicianId) ?? `فنيّ #${h.technicianId}`,
      unitCost: qy.showCost ? (cost != null ? Math.round(cost) : null) : null,
      total: qy.showCost && cost != null ? Math.round(cost * h.qty) : null,
      user: null, note: "آخرُ تغييرٍ للذمّة",
    });
  }

  const needle = qy.q ? arNorm(qy.q) : "";
  const filtered = rows.filter((r) => {
    if (qy.itemId != null && r.itemId !== qy.itemId) return false;
    if (qy.techId != null && r.technicianId !== qy.techId) return false;
    if (qy.officeId != null && r.fromTowerId !== qy.officeId && r.toTowerId !== qy.officeId) return false;
    if (qy.minQty != null && r.qty < qy.minQty) return false;
    if (qy.maxQty != null && r.qty > qy.maxQty) return false;
    if (qy.minPrice != null || qy.maxPrice != null) {
      const p = r.unitCost ?? r.total ?? null;
      if (p == null) return false;
      if (qy.minPrice != null && p < qy.minPrice) return false;
      if (qy.maxPrice != null && p > qy.maxPrice) return false;
    }
    if (!needle) return true;
    const hay = arNorm([
      r.itemName, r.technicianName ?? "", r.user ?? "", r.note, MOVE_LABEL[r.kind],
      r.fromTowerId != null ? towerName.get(r.fromTowerId) ?? "" : "",
      r.toTowerId != null ? towerName.get(r.toTowerId) ?? "" : "",
      String(r.qty), r.unitCost != null ? String(r.unitCost) : "", r.total != null ? String(r.total) : "",
    ].join(" "));
    return hay.includes(needle);
  });

  filtered.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { rows: filtered.slice(0, qy.take), truncated: filtered.length > qy.take };
}
