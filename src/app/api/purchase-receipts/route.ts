import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower, agentTowerIds } from "@/lib/guard";
import { movingAverage } from "@/app/api/_lib/itemBatchLog";
import { ensureOfficeCatalog, clearCatalogCache } from "@/lib/itemCatalog";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  itemId: z.coerce.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).nullable().optional(),
  qty: z.coerce.number().positive(),
  buyPrice: z.coerce.number().min(0),
  sellPrice: z.coerce.number().min(0).nullable().optional(),
});
const bodySchema = z.object({
  vendorName: z.string().trim().min(1, "اسم مكتب الشراء مطلوب"),
  receiptNumber: z.string().trim().nullable().optional(),
  date: z.string().nullable().optional(),
  towerId: z.coerce.number().int().positive(),
  note: z.string().trim().nullable().optional(),
  lines: z.array(lineSchema).min(1, "أضِف مادةً واحدةً على الأقلّ"),
  payment: z.object({
    type: z.enum(["cash", "debt"]),
    source: z.enum(["daily", "total"]).nullable().optional(),
  }),
});

// ═════ 🏬🧾 وصلُ شراءٍ متعدّدُ المواد + دفعاتٌ FIFO + تسديدٌ نقديٌّ/دَين ═════
export async function POST(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const b = parsed.data;

  // المكتبُ المستلِم: غيرُ المدير يُفرَض مكتبُه؛ المدير يختار (ويجب أن يتبعه)
  const towerId = g.session && !g.session.isAdmin && g.session.towerId != null ? g.session.towerId : b.towerId;
  if (!(await ownsTower(g.session, towerId))) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  if (b.payment.type === "cash" && b.payment.source !== "daily" && b.payment.source !== "total") {
    return NextResponse.json({ error: "اختر مصدرَ التسديد (اليوميّ أو الكلّيّ)" }, { status: 400 });
  }

  const total = Math.round(b.lines.reduce((a, l) => a + l.qty * l.buyPrice, 0));
  const when = b.date ? new Date(b.date) : new Date();
  const createdNewItem: number[] = [];

  const receipt = await prisma.$transaction(async (tx) => {
    const rec = await tx.purchaseReceipt.create({
      data: { agentId, towerId, vendorName: b.vendorName, receiptNumber: b.receiptNumber ?? null, date: when, total, note: b.note ?? null, userId: g.session?.userId ?? null },
      select: { id: true },
    });

    for (const line of b.lines) {
      // حلُّ المادة: بالمعرّف (يجب أن تتبع المكتب) أو بالاسم (قائمةٌ أو جديدة)
      let item: { id: number; count: number | null; priceDinar: number | null } | null = null;
      if (line.itemId) {
        item = await tx.item.findFirst({ where: { id: line.itemId, towerId, isDeleted: false }, select: { id: true, count: true, priceDinar: true } });
      } else if (line.name) {
        item = await tx.item.findFirst({ where: { towerId, isDeleted: false, name: { equals: line.name, mode: "insensitive" } }, select: { id: true, count: true, priceDinar: true } });
        if (!item) {
          const made = await tx.item.create({ data: { name: line.name, towerId, count: 0, priceDinar: 0, priceSale: line.sellPrice ?? null }, select: { id: true, count: true, priceDinar: true } });
          item = made; createdNewItem.push(made.id);
        }
      }
      if (!item) throw new Error("مادةٌ غير صالحة في أحد الأسطر");

      const oldCount = Number(item.count ?? 0);
      const oldAvg = Number(item.priceDinar ?? 0);
      const newAvg = movingAverage(oldCount, oldAvg, line.qty, line.buyPrice);
      // دفعةٌ بكلفتها (لا تختلط مع دفعاتٍ سابقة) — أساسُ FIFO
      await tx.itemBatch.create({
        data: { agentId, towerId, itemId: item.id, receiptId: rec.id, buyPrice: line.buyPrice, sellPrice: line.sellPrice ?? null, qty: line.qty, remaining: line.qty, date: when },
      });
      // العرضُ فقط: العددُ الكلّيُّ ومتوسّطُ الكلفة (البيعُ يعتمد الدفعات لا هذا)
      await tx.item.update({
        where: { id: item.id },
        data: { count: oldCount + line.qty, priceDinar: Math.round(newAvg), ...(line.sellPrice != null ? { priceSale: line.sellPrice } : {}) },
      });
    }

    // التسديد: نقديٌّ ⇒ دفعةٌ كاملةٌ الآن (يوميّ/كلّيّ)؛ دَينٌ ⇒ لا شيءَ الآن (يظهر متبقّياً)
    if (b.payment.type === "cash" && total > 0) {
      await settlePurchase(tx, { agentId, receiptId: rec.id, amount: total, source: b.payment.source as "daily" | "total", towerId, userId: g.session?.userId ?? null, byUser: g.session?.fullName ?? g.session?.username ?? null, vendorName: b.vendorName });
    }
    return rec;
  });

  // فان-آوت الكتالوج للمواد الجديدة (خارج المعاملة)
  if (createdNewItem.length) {
    clearCatalogCache();
    await ensureOfficeCatalog(agentId, await agentTowerIds(g.session), { force: true }).catch(() => {});
  }
  return NextResponse.json({ ok: true, id: receipt.id, total }, { status: 201 });
}

// ينشئ حركةَ المال + قيدَ الدفعة. daily ⇒ MoneyTx (يُنقص تقريرَ اليوم والكلّيّ)؛ total ⇒ ManagerTx (الكلّيّ فقط).
export async function settlePurchase(
  tx: Prisma.TransactionClient,
  p: { agentId: number; receiptId: number; amount: number; source: "daily" | "total"; towerId: number; userId: number | null; byUser: string | null; vendorName: string },
): Promise<void> {
  const notes = `شراء مخزن — ${p.vendorName} (وصل #${p.receiptId})`;
  let moneyTxId: number | null = null;
  let managerTxId: number | null = null;
  if (p.source === "daily") {
    const mt = await tx.moneyTx.create({
      data: { moneyIn: 0, moneyOut: p.amount, date: new Date(), serverDate: new Date(), userId: p.userId, towerId: p.towerId, sourceType: "purchase", sourceId: p.receiptId, notes },
      select: { id: true },
    });
    moneyTxId = mt.id;
  } else {
    const mt = await tx.managerTx.create({
      data: { type: "expense", amount: p.amount, userId: p.userId, agentId: p.agentId, byUser: p.byUser, notes },
      select: { id: true },
    });
    managerTxId = mt.id;
  }
  await tx.purchasePayment.create({
    data: { agentId: p.agentId, receiptId: p.receiptId, amount: p.amount, source: p.source, moneyTxId, managerTxId, userId: p.userId },
  });
}

// سجلُّ وصولات الشراء + المتبقّي (دَين) لكلّ وصل
export async function GET(request: Request) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });

  const sp = new URL(request.url).searchParams;
  const towers = await agentTowerIds(g.session);
  const askTower = Number(sp.get("tower")) || 0;
  const scope = askTower && towers.includes(askTower) ? [askTower] : towers;

  const receipts = await prisma.purchaseReceipt.findMany({
    where: { agentId, towerId: { in: scope }, isDeleted: false },
    orderBy: { date: "desc" }, take: 400,
    select: { id: true, towerId: true, vendorName: true, receiptNumber: true, date: true, total: true, note: true },
  });
  const ids = receipts.map((r) => r.id);
  const pays = ids.length
    ? await prisma.purchasePayment.groupBy({ by: ["receiptId"], where: { receiptId: { in: ids }, isDeleted: false }, _sum: { amount: true } })
    : [];
  const paidBy = new Map<number, number>();
  for (const p of pays) paidBy.set(p.receiptId, Math.round(Number(p._sum.amount ?? 0)));
  const towerName = new Map<number, string>();
  for (const t of await prisma.tower.findMany({ where: { id: { in: scope } }, select: { id: true, name: true } })) towerName.set(t.id, t.name ?? String(t.id));

  const rows = receipts.map((r) => {
    const paid = paidBy.get(r.id) ?? 0;
    return { id: r.id, office: towerName.get(r.towerId) ?? String(r.towerId), vendorName: r.vendorName, receiptNumber: r.receiptNumber, date: r.date, total: Math.round(r.total), paid, remaining: Math.round(r.total) - paid, note: r.note };
  });
  return NextResponse.json({ receipts: rows, totalDebt: rows.reduce((a, r) => a + Math.max(0, r.remaining), 0) });
}
