import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { ensureAgentStoreTables, STORE_ORDER_STATES, storeOrderLines } from "@/lib/agentStore";
import { priceToNum } from "@/lib/market";

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
  // 🎁 «لديه رصيدُ مكافأة» (طلبُ محمد 2026-10-26): الرصيدُ **لا يُخصَم هنا** — قرارُ محمد
  //    أن يبقى الخصمُ عند الفنيّ في الفاتورة الحقيقيّة. هذا بيانٌ للوكيل فقط ليعلم.
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
  return NextResponse.json({ orders: orders.map((o) => ({ ...o, price: priceToNum(o.price), deliveryFee: priceToNum(o.deliveryFee), installFee: priceToNum(o.installFee), total: priceToNum(o.total), rewardBalance: reward.get(o.subscriberId) ?? 0, lines: byOrder.get(o.id) ?? [] })) });
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
  const own = await prisma.storeOrder.updateMany({ where: { id, agentId, status: { in: ["new", "accepted"] } }, data: { status } });
  if (own.count === 0) {
    const exists = await prisma.storeOrder.findFirst({ where: { id, agentId }, select: { id: true } });
    return NextResponse.json({ error: exists ? "الطلبُ لم يعد فاعلاً" : "غير موجود" }, { status: exists ? 409 : 404 });
  }
  return NextResponse.json({ ok: true });
}
