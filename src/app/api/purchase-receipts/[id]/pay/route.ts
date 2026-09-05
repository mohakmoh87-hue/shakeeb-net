import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { settlePurchase } from "../../route";

export const dynamic = "force-dynamic";

const schema = z.object({
  amount: z.coerce.number().positive().nullable().optional(),
  source: z.enum(["daily", "total"]),
});

// 🏬💳 تسديدُ دَينِ وصلِ شراءٍ (كلّاً أو جزءاً) — من التقرير اليوميّ أو المبلغ الكلّيّ
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذا الحساب" }, { status: 400 });
  const id = Number((await params).id) || 0;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const rec = await prisma.purchaseReceipt.findFirst({ where: { id, agentId, isDeleted: false }, select: { id: true, towerId: true, total: true, vendorName: true } });
  if (!rec) return NextResponse.json({ error: "الوصل غير موجود" }, { status: 404 });
  if (!(await ownsTower(g.session, rec.towerId))) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  // 🔒 الحسابُ والخصمُ **داخل معاملةٍ بقفلٍ على الوصل** — يمنع سباقَ تسديدٍ مزدوجٍ (خصمُ مالٍ مرّتين)
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(823002, ${id})`;
    const agg = await tx.purchasePayment.aggregate({ where: { receiptId: id, isDeleted: false }, _sum: { amount: true } });
    const paid = Math.round(Number(agg._sum.amount ?? 0));
    const remaining = Math.round(rec.total) - paid;
    if (remaining <= 0) return { error: "لا دينَ متبقٍّ على هذا الوصل" };
    const amount = Math.min(Math.round(parsed.data.amount ?? remaining), remaining);
    if (amount <= 0) return { error: "مبلغٌ غير صالح" };
    await settlePurchase(tx, { agentId, receiptId: id, amount, source: parsed.data.source, towerId: rec.towerId, userId: g.session?.userId ?? null, byUser: g.session?.fullName ?? g.session?.username ?? null, vendorName: rec.vendorName });
    return { paid: paid + amount, remaining: remaining - amount };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, ...result });
}
