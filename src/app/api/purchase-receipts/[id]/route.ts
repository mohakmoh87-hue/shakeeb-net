import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { clearCatalogCache } from "@/lib/itemCatalog";

export const dynamic = "force-dynamic";

// ═════ 🏬🔍 تفاصيلُ وصل الشراء (موادُّه ودفعاتُ تسديده) ═════
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });
  const id = Number((await params).id) || 0;

  const rec = await prisma.purchaseReceipt.findFirst({
    where: { id, agentId, isDeleted: false },
    select: { id: true, towerId: true, vendorName: true, receiptNumber: true, date: true, total: true, note: true },
  });
  if (!rec) return NextResponse.json({ error: "الوصل غير موجود" }, { status: 404 });
  if (!(await ownsTower(g.session, rec.towerId))) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  const batches = await prisma.itemBatch.findMany({
    where: { receiptId: id, agentId, isDeleted: false },
    orderBy: { id: "asc" },
    select: { id: true, itemId: true, qty: true, remaining: true, buyPrice: true, sellPrice: true },
  });
  const itemIds = [...new Set(batches.map((b) => b.itemId))];
  const names = new Map<number, string>();
  if (itemIds.length) {
    for (const it of await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } })) {
      names.set(it.id, it.name ?? `#${it.id}`);
    }
  }
  const lines = batches.map((b) => ({
    id: b.id,
    itemId: b.itemId,
    name: names.get(b.itemId) ?? `#${b.itemId}`,
    qty: b.qty,
    remaining: b.remaining,
    sold: Math.max(0, b.qty - b.remaining),
    buyPrice: Math.round(b.buyPrice),
    sellPrice: b.sellPrice == null ? null : Math.round(b.sellPrice),
    total: Math.round(b.qty * b.buyPrice),
  }));

  const payRows = await prisma.purchasePayment.findMany({
    where: { receiptId: id, agentId, isDeleted: false },
    orderBy: { id: "asc" },
    select: { id: true, amount: true, source: true, createdAt: true },
  });
  const paid = payRows.reduce((a, p) => a + Math.round(p.amount), 0);

  return NextResponse.json({
    receipt: { ...rec, total: Math.round(rec.total), paid, remaining: Math.round(rec.total) - paid },
    lines,
    payments: payRows.map((p) => ({ id: p.id, amount: Math.round(p.amount), source: p.source, at: p.createdAt })),
  });
}

// ═════ 🗑️🏬 حذفُ وصل شراءٍ: يُرجع موادَّه ويعكس تسديداتِه (بصلاحيّة مسح الوصولات) ═════
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("receipts.void");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });
  const id = Number((await params).id) || 0;

  const rec = await prisma.purchaseReceipt.findFirst({
    where: { id, agentId, isDeleted: false },
    select: { id: true, towerId: true, vendorName: true, receiptNumber: true, total: true },
  });
  if (!rec) return NextResponse.json({ error: "الوصل غير موجود" }, { status: 404 });
  if (!(await ownsTower(g.session, rec.towerId))) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(823002, ${id})`;
    const still = await tx.purchaseReceipt.findFirst({ where: { id, agentId, isDeleted: false }, select: { id: true } });
    if (!still) return { error: "الوصل محذوفٌ سلفاً" };

    const batches = await tx.itemBatch.findMany({
      where: { receiptId: id, agentId, isDeleted: false },
      select: { id: true, itemId: true, qty: true, remaining: true },
    });

    const sold = batches.filter((b) => b.remaining < b.qty);
    if (sold.length) {
      const ids = [...new Set(sold.map((b) => b.itemId))];
      const names = new Map<number, string>();
      for (const it of await tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) {
        names.set(it.id, it.name ?? `#${it.id}`);
      }
      const detail = sold.map((b) => `«${names.get(b.itemId) ?? b.itemId}» بِيع منها ${b.qty - b.remaining}`).join("، ");
      return { error: `لا يمكن حذفُ الوصل: ${detail} — ألغِ فواتيرَ البيع أوّلاً كي ترجع البضاعةُ لدفعتها` };
    }

    let removedQty = 0;
    const touched = [...new Set(batches.map((b) => b.itemId))];
    for (const b of batches) {
      await tx.itemBatch.update({ where: { id: b.id }, data: { isDeleted: true } });
      await tx.item.update({ where: { id: b.itemId }, data: { count: { decrement: b.qty } } });
      removedQty += b.qty;
    }

    const agentOffices = (await tx.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } })).map((t) => t.id);
    const droppable = async (row: { id: number; count: number | null }) => {
      if (Math.max(0, Number(row.count ?? 0)) > 0) return false;
      if (await tx.itemBatch.count({ where: { itemId: row.id, isDeleted: false } })) return false;
      if (await tx.saleConsumption.count({ where: { itemId: row.id } })) return false;
      if (await tx.invoiceItem.count({ where: { itemId: row.id, isDeleted: false } })) return false;
      return true;
    };

    let droppedItems = 0;
    let droppedTwins = 0;
    for (const itemId of touched) {
      const item = await tx.item.findFirst({ where: { id: itemId, isDeleted: false }, select: { id: true, count: true, name: true } });
      const left = Math.max(0, Number(item?.count ?? 0));
      if (item && Number(item.count ?? 0) < 0) await tx.item.update({ where: { id: itemId }, data: { count: 0 } });
      const live = await tx.itemBatch.findMany({
        where: { itemId, isDeleted: false },
        select: { qty: true, remaining: true, buyPrice: true },
      });
      if (live.length) {
        const q = live.reduce((a, x) => a + Math.max(0, x.remaining), 0);
        const v = live.reduce((a, x) => a + Math.max(0, x.remaining) * x.buyPrice, 0);
        if (q > 0) await tx.item.update({ where: { id: itemId }, data: { priceDinar: Math.round(v / q) } });
        continue;
      }
      if (!item || left > 0) continue;
      if (!(await droppable({ id: item.id, count: 0 }))) continue;
      await tx.item.update({ where: { id: itemId }, data: { isDeleted: true } });
      droppedItems++;
      // الاسمُ يُفرَّخ في كلّ مكاتب الوكيل بكميّة صفر عند إنشائه، وبقاءُ صفٍّ منها يُعيد
      // إنشاءَ الصفّ المحذوف من الكتالوج — فتُشطب النظائرُ الفارغةُ وحدَها.
      const twins = item.name
        ? await tx.item.findMany({
            where: { id: { not: itemId }, isDeleted: false, towerId: { in: agentOffices }, name: { equals: item.name, mode: "insensitive" } },
            select: { id: true, count: true },
          })
        : [];
      for (const t of twins) {
        if (!(await droppable(t))) continue;
        await tx.item.update({ where: { id: t.id }, data: { isDeleted: true } });
        droppedTwins++;
      }
    }

    const pays = await tx.purchasePayment.findMany({
      where: { receiptId: id, agentId, isDeleted: false },
      select: { id: true, amount: true, moneyTxId: true, managerTxId: true },
    });
    let refunded = 0;
    for (const p of pays) {
      if (p.moneyTxId) await tx.moneyTx.updateMany({ where: { id: p.moneyTxId, isDeleted: false }, data: { isDeleted: true } });
      if (p.managerTxId) await tx.managerTx.updateMany({ where: { id: p.managerTxId, agentId, isDeleted: false }, data: { isDeleted: true } });
      await tx.purchasePayment.update({ where: { id: p.id }, data: { isDeleted: true } });
      refunded += Math.round(p.amount);
    }

    await tx.purchaseReceipt.update({ where: { id }, data: { isDeleted: true } });
    return { lines: batches.length, removedQty, droppedItems, droppedTwins, refunded };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  if (result.droppedItems || result.droppedTwins) clearCatalogCache();

  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId ?? null,
      action: "PURCHASE_RECEIPT_DELETE", entity: "purchase_receipt", entityId: String(id),
      details: `حذفُ وصل شراء ${rec.receiptNumber ? `رقم ${rec.receiptNumber}` : `#${id}`} — ${rec.vendorName}`
        + ` — مجموع ${Math.round(rec.total)} د.ع — ${result.lines} مادّة بعدد ${result.removedQty}`
        + (result.droppedItems ? ` — شُطبت ${result.droppedItems} مادّةً وُلدت بهذا الوصل` : "")
        + (result.droppedTwins ? ` (و${result.droppedTwins} صفّاً فارغاً لها في مكاتب الوكيل)` : "")
        + (result.refunded ? ` — أُعيد تسديدٌ بمقدار ${result.refunded} د.ع` : " — بلا تسديدٍ قائم")
        + ` — مكتب ${rec.towerId}`
        + (g.session?.fullName || g.session?.username ? ` — بواسطة ${g.session.fullName ?? g.session.username}` : ""),
    },
  }).catch(() => { /* لا يُفشل الحذفَ قيدٌ */ });

  return NextResponse.json({ ok: true, ...result });
}
