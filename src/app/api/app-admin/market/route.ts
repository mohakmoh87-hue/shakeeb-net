import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppAdminSession } from "@/lib/appAdminAuth";
import { ensureMarketTable, priceToNum } from "@/lib/market";
import { getMarketCategories, setMarketCategories } from "@/lib/appConfig";

export const dynamic = "force-dynamic";
const PAGE = 30;

// إدارةُ سوق المستعمل لأدمن التطبيق: كلُّ الإعلانات (بما فيها المخفيّة) + إخفاء/إظهار/حذف + الفئات.
export async function GET(request: Request) {
  const s = await getAppAdminSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  await ensureMarketTable();
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const where = q ? { OR: [{ title: { contains: q } }, { sellerName: { contains: q } }, { phone: { contains: q } }] } : {};
  const [items, total, visible, hidden, categories] = await Promise.all([
    prisma.marketListing.findMany({ where, orderBy: { id: "desc" }, take: PAGE, skip: (page - 1) * PAGE }),
    prisma.marketListing.count({ where }),
    prisma.marketListing.count({ where: { status: "visible" } }),
    prisma.marketListing.count({ where: { status: "hidden" } }),
    getMarketCategories(),
  ]);
  return NextResponse.json({ items: items.map((i) => ({ ...i, price: priceToNum(i.price) })), total, page, pages: Math.ceil(total / PAGE), counts: { visible, hidden }, categories });
}

export async function PATCH(request: Request) {
  const s = await getAppAdminSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (Array.isArray(b?.categories)) {
    await setMarketCategories(b.categories);
    return NextResponse.json({ ok: true, categories: await getMarketCategories() }); // القائمةُ الفعليّة (فارغةٌ ⇒ الافتراضيّة)
  }
  await ensureMarketTable();
  const id = Number(b?.id) || 0;
  if (!id || (b?.status !== "visible" && b?.status !== "hidden")) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  const row = await prisma.marketListing.findFirst({ where: { id }, select: { id: true } });
  if (!row) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.marketListing.update({ where: { id }, data: { status: b.status } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const s = await getAppAdminSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id")) || 0;
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  await ensureMarketTable();
  const row = await prisma.marketListing.findFirst({ where: { id }, select: { id: true } });
  if (!row) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await prisma.marketListing.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
