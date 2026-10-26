import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { subscriberAgentId } from "@/lib/agentStore";
import { ensureAgentAppTables } from "@/lib/agentAppOffers";

export const dynamic = "force-dynamic";

// 📱 صفحةُ «الباقات والعروض» للمشترك: باقاتُ وكيله المنشورةُ + عروضُه الخاصّةُ به.
// 🔒 طبقتا عزل: الوكيلُ مستنبَطٌ من مكتب المشترك (لا يُقبَل من الطلب)، والعرضُ يجب أن
// يكون **لوكيله** و**المشتركُ في جمهوره المثبَّت** — فلا يرى عرضَ غيره ولو شارك وكيله.
// 🔓 **للجميع** (قرارُ محمد 2026-10-26): الضيفُ وغيرُ المشترك والمنتهي يرون الباقاتِ
// المنشورةَ كي يعرفوا قبل أن يشتركوا. والعروضُ الخاصّةُ تبقى لصاحبها وحدَه — فمن لا
// جلسةَ مشتركٍ له **لا عروضَ خاصّةً له** بطبيعة الحال.
export async function GET() {
  const sess = await getSubscriberSession();
  await ensureAgentAppTables();
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
  // بلا وكيل (ضيفٌ/حسابُ غير مشتركٍ/مشتركٌ بلا مكتب) ⇒ الباقاتُ المنشورةُ لكلّ الوكلاء، ولا عروضَ خاصّة
  if (agentId == null) {
    const published = await prisma.agentAppPackage.findMany({ where: { visible: true }, select: { packageId: true, note: true, sort: true } });
    const metaAll = new Map(published.map((p) => [p.packageId, p]));
    const ids = published.map((p) => p.packageId);
    const rows = ids.length
      ? await prisma.package.findMany({ where: { id: { in: ids }, isDeleted: false }, select: { id: true, name: true, priceDinar: true } })
      : [];
    const packages = rows
      .filter((p) => (p.name ?? "").trim())
      .map((p) => ({
        id: p.id, name: (p.name ?? "").trim(),
        price: p.priceDinar != null ? Math.round(p.priceDinar) : null,
        note: metaAll.get(p.id)?.note ?? "", current: false, sort: metaAll.get(p.id)?.sort ?? 0,
      }))
      .sort((a, b) => a.sort - b.sort || (a.price ?? 0) - (b.price ?? 0));
    return NextResponse.json({ packages, offers: [] });
  }
  const sub = { packageId: myPackageId };

  const [published, targets] = await Promise.all([
    prisma.agentAppPackage.findMany({
      where: { agentId, visible: true },
      select: { packageId: true, note: true, sort: true },
    }),
    sess ? prisma.agentOfferTarget.findMany({ where: { subscriberId: sess.subscriberId }, select: { offerId: true } }) : Promise.resolve([] as { offerId: number }[]),
  ]);

  const pkgIds = published.map((p) => p.packageId);
  const pkgs = pkgIds.length
    ? await prisma.package.findMany({
        where: { id: { in: pkgIds }, agentId, isDeleted: false },
        select: { id: true, name: true, priceDinar: true },
      })
    : [];
  const meta = new Map(published.map((p) => [p.packageId, p]));
  const packages = pkgs
    .filter((p) => (p.name ?? "").trim())
    .map((p) => ({
      id: p.id,
      name: (p.name ?? "").trim(),
      price: p.priceDinar != null ? Math.round(p.priceDinar) : null,
      note: meta.get(p.id)?.note ?? "",
      current: p.id === sub.packageId,
      sort: meta.get(p.id)?.sort ?? 0,
    }))
    .sort((a, b) => a.sort - b.sort || (a.price ?? 0) - (b.price ?? 0));

  const offerIds = targets.map((t) => t.offerId);
  const offers = offerIds.length
    ? await prisma.agentOffer.findMany({
        where: { id: { in: offerIds }, agentId, isDeleted: false, status: "visible" },
        select: { id: true, text: true, image: true, createdAt: true },
        orderBy: { id: "desc" },
        take: 30,
      })
    : [];

  return NextResponse.json({ packages, offers });
}
