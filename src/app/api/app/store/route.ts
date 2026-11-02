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
  const SELECT = { id: true, agentId: true, agentName: true, title: true, price: true, description: true, photo: true, category: true, stock: true, itemName: true, deliveryFee: true, installFee: true, createdAt: true } as const;
  // شريحةُ المشترِي: مشتركٌ لدى الوكيل البائع أم لا (الزائرُ ⇒ غيرُ مشترك) — تُحدّد رسومَ الوكيل
  // الاحتياطيّة للمواد التي لم يضع لها الوكيلُ رسماً خاصّاً بها.
  const sess = await getSubscriberSession();
  const viewerAgentId = sess ? await subscriberAgentId(sess.subscriberId) : null;

  const [total, catRows] = await Promise.all([
    prisma.agentProduct.count({ where }),
    prisma.agentProduct.findMany({ where: { status: "visible", NOT: { category: null } }, select: { category: true }, distinct: ["category"], take: 60 }),
  ]);
  const categories = catRows.map((c) => c.category).filter((c): c is string => !!c).sort();

  // 🏬 موادُّ **وكيلِ المشترك أوّلاً** ثمّ بقيّةُ الوكلاء (طلبُ محمد 2026-11-02) — والترقيمُ
  //    يمرّ على القائمتَين كأنّهما واحدة، فلا تتكرّر مادّةٌ ولا تسقط بين صفحتَين.
  const skip = (page - 1) * PAGE;
  const items = await (async () => {
    if (viewerAgentId == null) {
      return prisma.agentProduct.findMany({ where, orderBy: { id: "desc" }, skip, take: PAGE, select: SELECT });
    }
    const mineWhere = { ...where, agentId: viewerAgentId };
    const mineCount = await prisma.agentProduct.count({ where: mineWhere });
    const fromMine = Math.max(0, Math.min(PAGE, mineCount - skip));
    const mine = fromMine > 0
      ? await prisma.agentProduct.findMany({ where: mineWhere, orderBy: { id: "desc" }, skip, take: fromMine, select: SELECT })
      : [];
    if (mine.length >= PAGE) return mine;
    const rest = await prisma.agentProduct.findMany({
      where: { ...where, NOT: { agentId: viewerAgentId } }, orderBy: { id: "desc" },
      skip: Math.max(0, skip - mineCount), take: PAGE - mine.length, select: SELECT,
    });
    return [...mine, ...rest];
  })();
  // 🏷️ اسمُ المتجر على كلّ مادّة (طلبُ محمد 2026-11-02): **اسمُ مكتبه** حين يكون للوكيل مكتبٌ
  //    واحد، وإلّا اسمُ الوكيل — فالمادّةُ تُنشَر للوكيل كلِّه لا لمكتبٍ بعينه، فلا نسمّي مكتباً
  //    بما لا يخصّه وحدَه.
  const agentIds = [...new Set(items.map((i) => i.agentId))];
  const towers = agentIds.length
    ? await prisma.tower.findMany({ where: { agentId: { in: agentIds }, isDeleted: false }, select: { agentId: true, name: true } })
    : [];
  const officeName = new Map<number, string | null>();
  for (const t of towers) {
    if (t.agentId == null) continue;
    officeName.set(t.agentId, officeName.has(t.agentId) ? null : t.name);
  }

  const [live, fees] = await Promise.all([
    liveStockFor(items.map((i) => ({ id: i.id, agentId: i.agentId, itemName: i.itemName }))),
    feesForProducts(items.map((i) => ({ id: i.id, agentId: i.agentId, deliveryFee: i.deliveryFee, installFee: i.installFee })), viewerAgentId),
  ]);
  return NextResponse.json({
    items: items.map((i) => ({
      id: i.id, agentId: i.agentId, agentName: i.agentName,
      storeName: officeName.get(i.agentId) ?? i.agentName ?? "",
      title: i.title, description: i.description, photo: i.photo, category: i.category, createdAt: i.createdAt,
      price: priceToNum(i.price),
      deliveryFee: fees.get(i.id)?.deliveryFee ?? null, installFee: fees.get(i.id)?.installFee ?? null,
      stock: i.itemName ? (live.get(i.id) ?? 0) : i.stock,
    })),
    total, page, pages: Math.ceil(total / PAGE), categories,
    // 🎁 وكيلُ المشترك — تحتاجه السلّةُ لتعرف أنّ المتجرَ متجرُ **وكيله** فتعرض خصمَ
    //    المكافأة (طلبُ محمد 2026-10-26). معرّفُ وكيله هو، لا معرّفَ غيره.
    myAgentId: viewerAgentId,
  });
}
