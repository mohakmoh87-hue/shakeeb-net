import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureAgentStoreTables, liveStockFor, feesForProducts, subscriberAgentId } from "@/lib/agentStore";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { priceToNum } from "@/lib/market";

export const dynamic = "force-dynamic";

// 🏬 متجرُ الوكيل — تصفّحُ منتجات كلّ الوكلاء (مفتوحٌ للزائر). كلُّ منتجٍ يحمل اسمَ متجره.
export async function GET(request: Request) {
  await ensureAgentStoreTables();
  const url = new URL(request.url);
  const cat = (url.searchParams.get("cat") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const PAGE = 20;
  const where: { status: string; category?: string; OR?: { title?: { contains: string }; description?: { contains: string }; agentName?: { contains: string } }[] } = { status: "visible" };
  if (cat) where.category = cat;
  if (q) where.OR = [{ title: { contains: q } }, { description: { contains: q } }, { agentName: { contains: q } }];
  const [items, total, catRows] = await Promise.all([
    prisma.agentProduct.findMany({
      where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE, take: PAGE,
      select: { id: true, agentId: true, agentName: true, title: true, price: true, description: true, photo: true, category: true, stock: true, itemName: true, createdAt: true },
    }),
    prisma.agentProduct.count({ where }),
    prisma.agentProduct.findMany({ where: { status: "visible", NOT: { category: null } }, select: { category: true }, distinct: ["category"], take: 60 }),
  ]);
  const categories = catRows.map((c) => c.category).filter((c): c is string => !!c).sort();
  // شريحةُ المشترِي: مشتركٌ لدى الوكيل البائع أم لا (الزائرُ ⇒ غيرُ مشترك) — تُحدّد رسومَ الوكيل.
  const sess = await getSubscriberSession();
  const viewerAgentId = sess ? await subscriberAgentId(sess.subscriberId) : null;
  const [live, fees] = await Promise.all([
    liveStockFor(items.map((i) => ({ id: i.id, agentId: i.agentId, itemName: i.itemName }))),
    feesForProducts(items.map((i) => ({ id: i.id, agentId: i.agentId })), viewerAgentId),
  ]);
  return NextResponse.json({
    items: items.map((i) => ({
      id: i.id, agentId: i.agentId, agentName: i.agentName, title: i.title, description: i.description, photo: i.photo, category: i.category, createdAt: i.createdAt,
      price: priceToNum(i.price),
      deliveryFee: fees.get(i.id)?.deliveryFee ?? null, installFee: fees.get(i.id)?.installFee ?? null,
      stock: i.itemName ? (live.get(i.id) ?? 0) : i.stock,
    })),
    total, page, pages: Math.ceil(total / PAGE), categories,
  });
}
