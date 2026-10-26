import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { subscriberAgentId } from "@/lib/agentStore";

export const dynamic = "force-dynamic";

// 📦 أسعارُ الاشتراكات. قراءةٌ محضة، ووكيلُ المشترك **مستنبَطٌ من مكتبه** لا يُقبَل
// من الطلب — فلا يرى مشتركٌ أسعارَ وكيلٍ آخرَ باسم وكيله.
// 🔓 الأسعارُ **للجميع بلا استثناء** (قرارُ محمد 2026-10-26): المشتركُ يراها بباقته
// مُعلَّمةً، وغيرُ المشترك والضيفُ يريانها ليعرفا قبل أن يشتركا. ومن لا وكيلَ له
// تُعرَض أسعارُ كلّ الوكلاء مجموعةً (بلا أيّ بيانِ مشترك).
export async function GET() {
  const sess = await getSubscriberSession();
  let agentId: number | null = null;
  let myPackageId: number | null = null;
  if (sess) {
    const sub = await prisma.subscriber.findUnique({
      where: { id: sess.subscriberId },
      select: { packageId: true, appBanned: true },
    });
    if (sub?.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });
    myPackageId = sub?.packageId ?? null;
    agentId = await subscriberAgentId(sess.subscriberId);
  }
  // ضيفٌ أو حسابُ غير مشتركٍ أو مشتركٌ بلا وكيل ⇒ كلُّ الباقات المنشورة
  if (agentId == null) {
    const published = await prisma.agentAppPackage.findMany({ where: { visible: true }, select: { packageId: true } });
    const ids = published.map((x) => x.packageId);
    const rows = ids.length
      ? await prisma.package.findMany({
          where: { id: { in: ids }, isDeleted: false },
          select: { id: true, name: true, priceDinar: true, priceDollar: true },
          orderBy: [{ priceDinar: "asc" }, { id: "asc" }],
        })
      : [];
    return NextResponse.json({
      items: rows.filter((p) => (p.name ?? "").trim()).map((p) => ({
        id: p.id, name: (p.name ?? "").trim(),
        price: p.priceDinar != null ? Math.round(p.priceDinar) : null,
        priceDollar: p.priceDollar ?? null, current: false,
      })),
      mine: null, allAgents: true,
    });
  }
  const sub = { packageId: myPackageId };

  const rows = await prisma.package.findMany({
    where: { agentId, isDeleted: false },
    select: { id: true, name: true, priceDinar: true, priceDollar: true },
    orderBy: [{ priceDinar: "asc" }, { id: "asc" }],
  });
  const items = rows
    .filter((p) => (p.name ?? "").trim())
    .map((p) => ({
      id: p.id,
      name: (p.name ?? "").trim(),
      price: p.priceDinar != null ? Math.round(p.priceDinar) : null,
      priceDollar: p.priceDollar ?? null,
      current: p.id === sub.packageId,
    }));
  return NextResponse.json({ items, mine: sub.packageId ?? null });
}
