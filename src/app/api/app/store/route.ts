import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureAgentStoreTables } from "@/lib/agentStore";
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
      select: { id: true, agentId: true, agentName: true, title: true, price: true, description: true, photo: true, category: true, stock: true, createdAt: true },
    }),
    prisma.agentProduct.count({ where }),
    prisma.agentProduct.findMany({ where: { status: "visible", NOT: { category: null } }, select: { category: true }, distinct: ["category"], take: 60 }),
  ]);
  const categories = catRows.map((c) => c.category).filter((c): c is string => !!c).sort();
  return NextResponse.json({ items: items.map((i) => ({ ...i, price: priceToNum(i.price) })), total, page, pages: Math.ceil(total / PAGE), categories });
}
