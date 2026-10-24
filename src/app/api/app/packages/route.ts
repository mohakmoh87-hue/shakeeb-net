import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { subscriberAgentId } from "@/lib/agentStore";

export const dynamic = "force-dynamic";

// 📦 أسعارُ اشتراكات **وكيل المشترك** — لشاشة «أسعار الاشتراكات» في التطبيق.
// قراءةٌ محضة، ومعزولةٌ بوكيلِ المشترك المستنبَطِ من مكتبه (`subscriberAgentId`): لا يرى
// أسعارَ وكيلٍ آخرَ أبداً، ولا يُقبَل وكيلٌ من الطلب. والزائرُ (بلا جلسة) لا أسعارَ له.
export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  const sub = await prisma.subscriber.findUnique({
    where: { id: sess.subscriberId },
    select: { packageId: true, appBanned: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (sub.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });

  const agentId = await subscriberAgentId(sess.subscriberId);
  if (agentId == null) return NextResponse.json({ items: [], mine: null });

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
