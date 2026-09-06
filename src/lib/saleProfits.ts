// ═════ 🏷️ أرباحُ المبيع — حسابٌ للقراءة لا قيدٌ ماليّ (طلب محمد 2026-09-05) ═════
// خمسةُ مربّعات: انتشار (كارت داخل المكتب = سعرُ باقةٍ مُجمَّد − كلفةُ كارتٍ مُجمَّدة) · توصيل
// (addPrice) · مبيعات (من دفتر FIFO: بيع − كلفةٌ فعليّة) · نثرية (صرفُ حسابات النثرية) · صافي.
// شهريٌّ بآليّةِ «أرباح الشركة» لكن بمفاتيحَ مستقلّة (saleEpoch/salePeriod)؛ ويقبل بحثاً بين
// تاريخين بأثرٍ رجعيٍّ (بلا قصٍّ على التأسيس). عزلٌ بالمكتب، وتفصيلٌ بالمستخدم المنفصل (كاسبر).

import { prisma } from "@/lib/prisma";
import { monthRange, baghdadParts, monthLabel } from "@/lib/profits";
import { notMaster } from "@/lib/moneyKinds";

const monthStart = (y: number, m: number) => monthRange(y, m).from;
const monthEnd = (y: number, m: number) => monthRange(y, m).to;

// ───────── إعداداتُ الفترة (فضاءُ أسماءٍ مستقلٌّ عن أرباح الشركة) ─────────
const S_EPOCH = (a: number) => `saleEpoch:${a}`;
const S_PERIOD = (a: number) => `salePeriod:${a}`;
const S_VIEW = (u: number) => `saleProfitView:${u}`;

async function readSetting(type: string): Promise<string | null> {
  const r = await prisma.systemSetting.findFirst({ where: { type }, select: { text: true }, orderBy: { id: "asc" } });
  return r?.text ?? null;
}
async function writeSetting(type: string, text: string): Promise<void> {
  const r = await prisma.systemSetting.findFirst({ where: { type }, select: { id: true }, orderBy: { id: "asc" } });
  if (r) await prisma.systemSetting.update({ where: { id: r.id }, data: { text } });
  else await prisma.systemSetting.create({ data: { type, text } });
}

export type SalePeriod = { from: Date; to: Date; label: string; ended: boolean; nextFrom: Date | null; epoch: Date };

export async function getSalePeriod(agentId: number, now = new Date()): Promise<SalePeriod> {
  // التأسيسُ من **بداية الشهر الحاليّ** لا لحظةَ أوّل فتح — كي يعرض الشهرَ كاملاً (رجعيّاً)
  let epochTxt = await readSetting(S_EPOCH(agentId));
  if (!epochTxt) { const n0 = baghdadParts(now); epochTxt = monthStart(n0.y, n0.m).toISOString(); await writeSetting(S_EPOCH(agentId), epochTxt); }
  const epoch = new Date(epochTxt);
  let fromTxt = await readSetting(S_PERIOD(agentId));
  if (!fromTxt) { fromTxt = epoch.toISOString(); await writeSetting(S_PERIOD(agentId), fromTxt); }
  let from = new Date(fromTxt);
  if (from < epoch) from = epoch;
  const f = baghdadParts(from), n = baghdadParts(now);
  const monthsPassed = (n.y - f.y) * 12 + (n.m - f.m);
  if (monthsPassed >= 2) { from = monthStart(n.y, n.m); if (from < epoch) from = epoch; await writeSetting(S_PERIOD(agentId), from.toISOString()); }
  const ff = baghdadParts(from);
  const to = monthEnd(ff.y, ff.m);
  return { from, to, label: monthLabel(from), ended: now > to, nextFrom: now > to ? monthStart(n.y, n.m) : null, epoch };
}

export async function startNewSaleMonth(agentId: number, now = new Date()): Promise<SalePeriod> {
  const n = baghdadParts(now);
  const cur = await getSalePeriod(agentId, now);
  const from = cur.ended ? monthStart(n.y, n.m) : now;
  await writeSetting(S_PERIOD(agentId), from.toISOString());
  return getSalePeriod(agentId, now);
}

export type SaleView = { mode?: string; month?: string; from?: string; to?: string; tower?: number };
export async function getSaleView(userId: number): Promise<SaleView | null> {
  const t = await readSetting(S_VIEW(userId));
  if (!t) return null;
  try { return JSON.parse(t) as SaleView; } catch { return null; }
}
export async function saveSaleView(userId: number, v: SaleView): Promise<void> {
  await writeSetting(S_VIEW(userId), JSON.stringify({ mode: v.mode ?? "current", month: v.month ?? "", from: v.from ?? "", to: v.to ?? "", tower: Number(v.tower) || 0 }));
}

// ───────── الحساب ─────────
export type SaleRow = { name: string; sub: string | null; office: string; user: string | null; at: Date | null; amount: number };
export type SaleBox = { count: number; total: number; rows: SaleRow[] };
export type SaleUserRow = { userId: number; name: string; spread: number; spreadN: number; delivery: number; deliveryN: number; sales: number; salesN: number; petty: number; pettyN: number; net: number };
export type SaleReport = {
  boxes: { spread: SaleBox; delivery: SaleBox; sales: SaleBox; petty: SaleBox };
  net: number;
  byUser: SaleUserRow[];
};

const box = (): SaleBox => ({ count: 0, total: 0, rows: [] });
const R = (n: number) => Math.round(n);

export async function computeSaleProfits(agentId: number, towerIds: number[], from: Date, to: Date): Promise<SaleReport> {
  const out: SaleReport = { boxes: { spread: box(), delivery: box(), sales: box(), petty: box() }, net: 0, byUser: [] };
  if (!towerIds.length) return out;

  const towers = await prisma.tower.findMany({ where: { id: { in: towerIds } }, select: { id: true, name: true } });
  const officeName = new Map<number, string>();
  for (const t of towers) officeName.set(t.id, t.name ?? String(t.id));

  // المستخدمون المنفصلون (نفسُ قاعدة كاسبر في أرباح الشركة): مكتبٌ فيه مؤشَّرٌ واحدٌ +٢ مستخدمين ⇒ يُفصَل كلُّه
  const officeUsers = await prisma.user.findMany({
    where: { agentId, towerId: { in: towerIds }, isDeleted: false, isActive: true, isOwner: false },
    select: { id: true, fullName: true, username: true, towerId: true, separateAccount: true },
  });
  const sepTowerSet = new Set(officeUsers.filter((u) => u.separateAccount).map((u) => u.towerId));
  const perTowerCount = new Map<number | null, number>();
  for (const u of officeUsers) perTowerCount.set(u.towerId, (perTowerCount.get(u.towerId) ?? 0) + 1);
  const sepUsers = officeUsers.filter((u) => sepTowerSet.has(u.towerId) && (perTowerCount.get(u.towerId) ?? 0) >= 2);
  const userName = new Map<number, string>();
  for (const u of officeUsers) userName.set(u.id, u.fullName ?? u.username ?? String(u.id));
  const sepIds = new Set(sepUsers.map((u) => u.id));
  type Acc = { spread: number; spreadN: number; delivery: number; deliveryN: number; sales: number; salesN: number; petty: number; pettyN: number };
  const acc = new Map<number, Acc>();
  const bump = (uid: number | null | undefined, k: "spread" | "delivery" | "sales" | "petty", amt: number) => {
    if (uid == null || !sepIds.has(uid)) return;
    const a = acc.get(uid) ?? { spread: 0, spreadN: 0, delivery: 0, deliveryN: 0, sales: 0, salesN: 0, petty: 0, pettyN: 0 };
    a[k] += amt; a[`${k}N` as keyof Acc]++; acc.set(uid, a);
  };

  // ① انتشار — كلُّ كارتٍ فُعِّل داخل المكتب: (سعرُ الباقة المُجمَّد) − (كلفةُ الكارت المُجمَّدة)
  const cards = await prisma.rechargeCard.findMany({
    where: { agentId, useDate: { gte: from, lte: to }, subscriberId: { not: null } },
    select: { id: true, price: true, sellAtUse: true, useDate: true, subscriberId: true, userId: true, userName: true, packageId: true },
  });
  const subIds = [...new Set(cards.map((c) => c.subscriberId!).filter((x) => x != null))];
  const subs = subIds.length ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, netUser: true, towerId: true } }) : [];
  const subById = new Map(subs.map((s) => [s.id, s]));
  const pkgIds = [...new Set(cards.map((c) => c.packageId).filter((x): x is number => x != null))];
  const pkgById = new Map((pkgIds.length ? await prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true, priceDinar: true } }) : []).map((p) => [p.id, p]));
  for (const c of cards) {
    const s = c.subscriberId != null ? subById.get(c.subscriberId) : undefined;
    const tw = s?.towerId ?? null;
    if (tw == null || !towerIds.includes(tw)) continue; // عزل + كارتٌ بلا مشترك حقيقيٍّ يُستبعَد
    // سعرُ البيع: اللقطةُ المُجمَّدة، وإلّا سعرُ الباقة الحاليّ (لكروتٍ فُعِّلت بمسارٍ لا يُجمِّد كالمزامنة)
    const sell = c.sellAtUse ?? (c.packageId != null ? pkgById.get(c.packageId)?.priceDinar ?? null : null);
    if (sell == null) continue; // لا سعرَ بيعٍ معروفٌ إطلاقاً ⇒ لا يُحتسَب انتشاره
    const profit = R(Number(sell) - Number(c.price ?? 0));
    out.boxes.spread.count++; out.boxes.spread.total += profit;
    bump(c.userId, "spread", profit);
    out.boxes.spread.rows.push({ name: c.packageId != null ? (pkgById.get(c.packageId)?.name ?? "") : "", sub: s?.name ?? s?.netUser ?? null, office: officeName.get(tw) ?? String(tw), user: c.userId != null ? userName.get(c.userId) ?? c.userName ?? null : c.userName ?? null, at: c.useDate, amount: profit });
  }

  // ② توصيل — مجموعُ ما يُدخَل في خانة التوصيل عند التفعيل (addPrice)
  const dels = await prisma.subscriptionEntry.findMany({
    where: { towerId: { in: towerIds }, isDeleted: false, date: { gte: from, lte: to }, addPrice: { gt: 0 } },
    select: { id: true, subscriberId: true, towerId: true, userId: true, date: true, addPrice: true, cardType: true },
  });
  const delSubIds = [...new Set(dels.map((d) => d.subscriberId).filter((x): x is number => x != null))];
  const delSubById = new Map((delSubIds.length ? await prisma.subscriber.findMany({ where: { id: { in: delSubIds } }, select: { id: true, name: true, netUser: true } }) : []).map((s) => [s.id, s]));
  // خريطةُ تواريخ addPrice لكلّ مشترك — لتفادي ازدواج بطاقة الميدان مع توصيلٍ سُجِّل عند التفعيل
  const addDates = new Map<number, number[]>();
  for (const d of dels) { if (d.subscriberId == null || !d.date) continue; const l = addDates.get(d.subscriberId) ?? []; l.push(d.date.getTime()); addDates.set(d.subscriberId, l); }
  for (const d of dels) {
    const amt = R(Number(d.addPrice ?? 0));
    const tw = d.towerId!;
    const s = d.subscriberId != null ? delSubById.get(d.subscriberId) : undefined;
    out.boxes.delivery.count++; out.boxes.delivery.total += amt;
    bump(d.userId, "delivery", amt);
    out.boxes.delivery.rows.push({ name: d.cardType ?? "توصيل", sub: s?.name ?? s?.netUser ?? null, office: officeName.get(tw) ?? String(tw), user: d.userId != null ? userName.get(d.userId) ?? null : null, at: d.date, amount: amt });
  }
  // ②ب توصيلُ الميدان — بطاقاتُ توصيلٍ مُنجَزةٌ (نوعُها deliveryOnly أو «توصيل»): مبلغُها إيرادُ توصيل.
  //     يُنفّذها الفنّيُّ لا مستخدمُ المكتب (مستوى المكتب). **تفادي الازدواج:** لا تُحتسَب بطاقةٌ
  //     لمشترٍكٍ سُجِّل توصيلُه addPrice ±٧ أيّام (هي نفسُ التوصيل الذي أُدخِل عند التفعيل).
  const WEEK = 7 * 86400_000;
  const delTypes = await prisma.cardType.findMany({ where: { agentId, isDeleted: false, deliveryOnly: true }, select: { name: true } });
  const delKinds = [...new Set([...delTypes.map((t) => t.name), "توصيل"])];
  const fieldDel = await prisma.taskCard.findMany({
    where: { officeId: { in: towerIds }, kind: { in: delKinds }, done: true, completedAt: { gte: from, lte: to } },
    select: { id: true, officeId: true, subscriberId: true, amount: true, completedAt: true, title: true },
  });
  for (const d of fieldDel) {
    const amt = R(Number(d.amount ?? 0));
    if (amt <= 0) continue;
    if (d.subscriberId != null && d.completedAt) {
      const ds = addDates.get(d.subscriberId);
      if (ds && ds.some((t) => Math.abs(t - d.completedAt!.getTime()) <= WEEK)) continue; // ازدواجٌ ⇒ عُدّ عند التفعيل
    }
    const tw = d.officeId ?? 0;
    out.boxes.delivery.count++; out.boxes.delivery.total += amt;
    out.boxes.delivery.rows.push({ name: d.title ?? "توصيل ميدان", sub: "🚚 ميدان", office: officeName.get(tw) ?? String(tw), user: null, at: d.completedAt, amount: amt });
  }

  // ③ مبيعات — من فواتير المبيع مباشرةً: (سعرُ البيع − الكلفةُ المُجمَّدة buyPrice) × العدد.
  //    buyPrice تضعه حلقةُ FIFO لكلّ بيعٍ (متوسّطُ الكلفة الفعليّة = مجموعُ الدفعات)، ويُملأ
  //    للفواتير السابقة بباك-فيل. يعمل بأثرٍ رجعيٍّ (بيعُ المستخدم والفنّي معاً). العزلُ بالمكتب.
  const invs = await prisma.invoice.findMany({
    where: { towerId: { in: towerIds }, isDeleted: false, date: { gte: from, lte: to } },
    select: { id: true, towerId: true, userId: true, date: true },
  });
  const invById = new Map(invs.map((i) => [i.id, i]));
  const invIds = invs.map((i) => i.id);
  const iitems = invIds.length
    ? await prisma.invoiceItem.findMany({ where: { invoiceId: { in: invIds }, isDeleted: false }, select: { invoiceId: true, itemId: true, count: true, price: true, buyPrice: true } })
    : [];
  const saleItemIds = [...new Set(iitems.map((x) => x.itemId).filter((x): x is number => x != null))];
  const itemName = new Map<number, string>();
  for (const it of (saleItemIds.length ? await prisma.item.findMany({ where: { id: { in: saleItemIds } }, select: { id: true, name: true } }) : [])) itemName.set(it.id, it.name ?? String(it.id));
  for (const it of iitems) {
    const inv = invById.get(it.invoiceId!);
    if (!inv) continue;
    const tw = inv.towerId ?? 0;
    const profit = R((Number(it.price ?? 0) - Number(it.buyPrice ?? 0)) * Number(it.count ?? 0));
    out.boxes.sales.count++; out.boxes.sales.total += profit;
    bump(inv.userId, "sales", profit);
    out.boxes.sales.rows.push({ name: it.itemId != null ? itemName.get(it.itemId) ?? String(it.itemId) : "—", sub: `×${Number(it.count ?? 0)}`, office: officeName.get(tw) ?? String(tw), user: inv.userId != null ? userName.get(inv.userId) ?? null : null, at: inv.date, amount: profit });
  }

  // ④ نثرية — صرفُ حسابات «نثرية» (moneyOut) بالمكتب والمستخدم
  const petty = await prisma.account.findMany({ where: { isDeleted: false, towerId: { in: towerIds }, name: { contains: "نثرية" } }, select: { id: true } });
  const pettyIds = petty.map((a) => a.id);
  if (pettyIds.length) {
    const rows = await prisma.moneyTx.findMany({
      where: { isDeleted: false, accountId: { in: pettyIds }, moneyOut: { gt: 0 }, date: { gte: from, lte: to }, towerId: { in: towerIds }, ...notMaster },
      select: { id: true, towerId: true, userId: true, date: true, moneyOut: true, notes: true },
    });
    for (const m of rows) {
      const amt = R(Number(m.moneyOut ?? 0));
      const tw = m.towerId ?? 0;
      out.boxes.petty.count++; out.boxes.petty.total += amt;
      bump(m.userId, "petty", amt);
      out.boxes.petty.rows.push({ name: m.notes ?? "نثرية", sub: null, office: officeName.get(tw) ?? String(tw), user: m.userId != null ? userName.get(m.userId) ?? null : null, at: m.date, amount: amt });
    }
  }

  // الصافي + قصُّ التفاصيل + جدولُ المستخدمين المنفصلين
  const B = out.boxes;
  out.net = B.spread.total + B.delivery.total + B.sales.total - B.petty.total;
  for (const b of [B.spread, B.delivery, B.sales, B.petty]) { b.total = R(b.total); b.rows.sort((a, c) => (c.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)); b.rows = b.rows.slice(0, 300); }
  out.net = R(out.net);
  for (const [uid, a] of acc) {
    out.byUser.push({ userId: uid, name: userName.get(uid) ?? String(uid), spread: R(a.spread), spreadN: a.spreadN, delivery: R(a.delivery), deliveryN: a.deliveryN, sales: R(a.sales), salesN: a.salesN, petty: R(a.petty), pettyN: a.pettyN, net: R(a.spread + a.delivery + a.sales - a.petty) });
  }
  out.byUser.sort((a, b2) => b2.net - a.net);
  return out;
}
