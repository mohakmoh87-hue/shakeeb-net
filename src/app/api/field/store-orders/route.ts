import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { ensureAgentStoreTables, STORE_ORDER_STATES, storeOrderLines } from "@/lib/agentStore";
import { priceToNum } from "@/lib/market";
import { reverseStoreOrderRedeem } from "@/lib/rewards";

export const dynamic = "force-dynamic";

// عمودُ «طلبات المتجر» في إدارة الفنيين — طلباتُ متجر الوكيل الواصلةُ له (معزولةٌ بـagentId البائع).
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ orders: [] });
  await ensureAgentStoreTables();
  // الطلباتُ الفاعلةُ فقط (new/accepted) فيختفي العمودُ حين تُنجَز كلُّها (طلب محمد)
  const orders = await prisma.storeOrder.findMany({ where: { agentId, status: { in: ["new", "accepted"] } }, orderBy: { id: "desc" }, take: 200 });
  const byOrder = await storeOrderLines(orders);
  // 🎁 رصيدُه **المتبقّي** بعد خصمِ هذا الطلب (قرارُ محمد 2026-11-04: الخصمُ يقع لحظةَ
  //    الإرسال في `app/store/orders`، والمخصومُ مختومٌ في `rewardUsed` على الطلب نفسِه).
  // 🔒 والعزل: لا يُكشَف الرصيدُ إلّا لمشتركٍ **من مكاتب هذا الوكيل**؛ فمشتركُ وكيلٍ
  //    آخرَ يشتري من متجرنا لا يُرى رصيدُه (مكافأتُه عند وكيله لا عندنا أصلاً).
  const subIds = [...new Set(orders.map((o) => o.subscriberId))];
  const reward = new Map<number, number>();
  if (subIds.length) {
    const myTowers = await prisma.tower.findMany({
      where: { agentId, isDeleted: false, rewardsEnabled: "1" },
      select: { id: true },
    });
    if (myTowers.length) {
      const subs = await prisma.subscriber.findMany({
        where: { id: { in: subIds }, isDeleted: false, rewardBalance: { gt: 0 }, towerId: { in: myTowers.map((t) => t.id) } },
        select: { id: true, rewardBalance: true },
      });
      for (const x of subs) reward.set(x.id, x.rewardBalance ?? 0);
    }
  }
  return NextResponse.json({ orders: orders.map((o) => ({ ...o, price: priceToNum(o.price), deliveryFee: priceToNum(o.deliveryFee), installFee: priceToNum(o.installFee), total: priceToNum(o.total), rewardUsed: priceToNum(o.rewardUsed), rewardBalance: reward.get(o.subscriberId) ?? 0, lines: byOrder.get(o.id) ?? [] })) });
}

export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "ليس لديك وكيل" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id) || 0;
  const status = typeof body?.status === "string" ? body.status : "";
  if (!id || !(STORE_ORDER_STATES as readonly string[]).includes(status)) return NextResponse.json({ error: "طلبٌ غير صالح" }, { status: 400 });
  await ensureAgentStoreTables();
  // تحديثٌ ذرّيٌّ من حالةٍ فاعلةٍ فقط — لئلّا يُحيي القبولُ طلباً ألغاه المشترك أو يُرجِعَ طلباً منتهياً
  // 🎁 ورفضُ الطلب (أو إلغاؤه من الوكيل) يُعيد ما خُصِم من مكافأته لحظةَ الإرسال — داخل
  //    المعاملة وبعد نجاح الانتقال وحدَه. و«سُلّم» لا يُرجِع شيئاً: البضاعةُ وصلت فالخصمُ حقٌّ.
  const own = await prisma.$transaction(async (tx) => {
    const claimed = await tx.storeOrder.updateMany({ where: { id, agentId, status: { in: ["new", "accepted"] } }, data: { status } });
    if (claimed.count !== 1 || (status !== "declined" && status !== "cancelled")) return claimed;
    const o = await tx.storeOrder.findUnique({ where: { id }, select: { subscriberId: true, rewardUsed: true } });
    if (o && (o.rewardUsed ?? BigInt(0)) > BigInt(0)) {
      const s = await tx.subscriber.findUnique({ where: { id: o.subscriberId }, select: { towerId: true } });
      await reverseStoreOrderRedeem(tx, { orderId: id, subscriberId: o.subscriberId, towerId: s?.towerId ?? null, agentId, createdByUser: g.session.username });
    }
    return claimed;
  });
  if (own.count === 0) {
    const exists = await prisma.storeOrder.findFirst({ where: { id, agentId }, select: { id: true } });
    return NextResponse.json({ error: exists ? "الطلبُ لم يعد فاعلاً" : "غير موجود" }, { status: exists ? 409 : 404 });
  }
  return NextResponse.json({ ok: true });
}
