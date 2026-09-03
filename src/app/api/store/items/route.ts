import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// مواد مخزن الوكيل للاختيار في «متجري»: أسماءٌ مميّزةٌ بمجموع العدد (كلّ مكاتب الوكيل) وسعر البيع.
export async function GET() {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const towerIds = await agentTowerIds(g.session);
  if (!towerIds.length) return NextResponse.json({ items: [] });
  const rows = await prisma.item.findMany({
    where: { isDeleted: false, towerId: { in: towerIds } },
    select: { name: true, priceSale: true, category: true, count: true },
    orderBy: { name: "asc" },
  });
  const byName = new Map<string, { name: string; price: number | null; category: string | null; count: number }>();
  for (const it of rows) {
    const name = (it.name ?? "").trim();
    if (!name) continue;
    const cur = byName.get(name) ?? { name, price: null, category: null, count: 0 };
    cur.count += it.count ?? 0;
    if (cur.price == null && it.priceSale != null) cur.price = it.priceSale;
    if (cur.category == null && it.category) cur.category = it.category;
    byName.set(name, cur);
  }
  const items = [...byName.values()].map((x) => ({ name: x.name, price: x.price == null ? null : Math.round(x.price), category: x.category, count: Math.round(x.count) }));
  return NextResponse.json({ items });
}
