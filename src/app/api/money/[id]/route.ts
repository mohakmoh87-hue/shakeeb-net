import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, towerScope } from "@/lib/guard";

export const dynamic = "force-dynamic";

// أسماء مصادر الحركات المالية للعرض
const SOURCE_LABELS: Record<string, string> = {
  activation: "وصل تفعيل",
  invoice: "فاتورة مبيع",
  debt: "تسديد دين",
  sale: "بيع من المخزن",
  salary: "راتب فني",
  master: "حساب الماستر",
  manual: "حركة يدوية",
};

// تفاصيل حركة مالية واحدة كاملة: المبلغ والمصدر والحساب والمكتب والمسجِّل والمرجع المرتبط.
// العزل بنفس نطاق قائمة الحركات (towerScope) — لا تُعرض حركة مكتبٍ لا يتبع المُشاهد.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("finance.view");
  if (g.error) return g.error;
  const { id } = await params;
  const txId = Number(id);
  if (!txId) return NextResponse.json({ error: "معرّف غير صحيح" }, { status: 400 });

  const t = await prisma.moneyTx.findFirst({ where: { id: txId, isDeleted: false, ...(await towerScope(g.session)) } });
  if (!t) return NextResponse.json({ error: "الحركة غير موجودة" }, { status: 404 });

  const [account, office, user] = await Promise.all([
    t.accountId ? prisma.account.findUnique({ where: { id: t.accountId }, select: { name: true } }) : null,
    t.towerId ? prisma.tower.findUnique({ where: { id: t.towerId }, select: { name: true } }) : null,
    t.userId ? prisma.user.findUnique({ where: { id: t.userId }, select: { fullName: true, username: true } }) : null,
  ]);

  // المرجع المرتبط حسب المصدر (المصدر يتبع مكتب الحركة نفسه — العزل محفوظ أعلاه)
  let ref: { label: string; url?: string } | null = null;
  if (t.sourceType === "activation" && t.sourceId) {
    const e = await prisma.subscriptionEntry.findUnique({ where: { id: t.sourceId }, select: { id: true, cardType: true, month: true, subscriberId: true, isDeleted: true } });
    const sub = e?.subscriberId ? await prisma.subscriber.findUnique({ where: { id: e.subscriberId }, select: { name: true, netUser: true } }) : null;
    if (e && !e.isDeleted) {
      ref = { label: `وصل تفعيل #${e.id} — ${sub?.name ?? "—"}${sub?.netUser ? ` (${sub.netUser})` : ""} — ${e.cardType ?? "—"}${e.month ? ` × ${e.month}` : ""}`, url: `/subscriptions/${e.id}/receipt` };
    }
  } else if (t.sourceType === "invoice" && t.sourceId) {
    const inv = await prisma.invoice.findUnique({ where: { id: t.sourceId }, select: { id: true, number: true, type: true, subscriberId: true, isDeleted: true } });
    const sub = inv?.subscriberId ? await prisma.subscriber.findUnique({ where: { id: inv.subscriberId }, select: { name: true } }) : null;
    if (inv && !inv.isDeleted) {
      ref = { label: `فاتورة ${inv.type ?? "مبيع"} رقم ${inv.number ?? inv.id}${sub?.name ? ` — ${sub.name}` : ""}`, url: `/invoices/${inv.id}/receipt` };
    }
  } else if (t.sourceType === "debt" && t.sourceId) {
    // في تسديد الدين sourceId = معرّف المشترك
    const sub = await prisma.subscriber.findUnique({ where: { id: t.sourceId }, select: { name: true, netUser: true } });
    if (sub) ref = { label: `تسديد دين المشترك ${sub.name ?? "—"}${sub.netUser ? ` (${sub.netUser})` : ""}` };
  } else if (t.sourceType === "sale" && t.sourceId) {
    const item = await prisma.item.findUnique({ where: { id: t.sourceId }, select: { name: true } });
    if (item) ref = { label: `بيع مادة: ${item.name ?? "—"}` };
  }

  return NextResponse.json({
    id: t.id,
    kind: (t.moneyIn ?? 0) > 0 ? "قبض" : "صرف",
    amount: (t.moneyIn ?? 0) > 0 ? t.moneyIn ?? 0 : t.moneyOut ?? 0,
    date: t.date,
    serverDate: t.serverDate,
    notes: t.notes,
    source: SOURCE_LABELS[t.sourceType ?? "manual"] ?? t.sourceType ?? "حركة يدوية",
    sourceType: t.sourceType ?? "manual",
    accountName: account?.name ?? null,
    officeName: office?.name ?? null,
    byName: user?.fullName ?? user?.username ?? null,
    ref,
  });
}
