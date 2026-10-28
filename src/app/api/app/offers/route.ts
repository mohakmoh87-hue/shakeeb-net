import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appClass } from "@/lib/subscriberAuth";
import { offerVisibleTo } from "@/lib/agentAppOffers";
import { subscriberAgentId } from "@/lib/agentStore";
import { ensureAgentAppTables } from "@/lib/agentAppOffers";

export const dynamic = "force-dynamic";

// 📱 صفحةُ «الباقات والعروض» للمشترك: باقاتُ وكيله المنشورةُ + عروضُه الخاصّةُ به.
// 🔒 طبقتا عزل: الوكيلُ مستنبَطٌ من مكتب المشترك (لا يُقبَل من الطلب)، والعرضُ يجب أن
// يكون **لوكيله** و**المشتركُ في جمهوره المثبَّت** — فلا يرى عرضَ غيره ولو شارك وكيله.
// 🔓 **للجميع** (قرارُ محمد 2026-10-26): الضيفُ وغيرُ المشترك والمنتهي يرون الباقاتِ
// المنشورةَ كي يعرفوا قبل أن يشتركوا.
// 🔓 وجمهورُ العرض يختاره الوكيل (طلبُ محمد 2026-10-27):
//   • `subs`   → المجموعةُ المثبَّتةُ بتاريخ الانتهاء، ولصنف "subs" وحدَه.
//   • `guests` → لغير المشتركين والمنتهين **أكثرَ من شهرٍ** والزوّار (الثلاثةُ سواء).
//   • `all`    → للجميع بلا تثبيتِ جمهور.
// ومن لا وكيلَ له (زائرٌ/حسابُ غير مشتركٍ/مشتركٌ بلا مكتب) ⇒ عروضُ كلّ الوكلاء
// المفتوحةُ له، كما هي الباقاتُ سلفاً: لا سبيلَ لنسبته إلى وكيلٍ بعينه.
export async function GET() {
  await ensureAgentAppTables();
  const { klass, subscriberId, packageId: myPkg } = await appClass();
  let agentId: number | null = null;
  let myPackageId: number | null = null;
  if (subscriberId != null) {
    const sub = await prisma.subscriber.findUnique({
      where: { id: subscriberId },
      select: { packageId: true, appBanned: true },
    });
    if (sub?.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });
    myPackageId = sub?.packageId ?? null;
    agentId = await subscriberAgentId(subscriberId);
  }

  // جمهورُ العرض: صنفُ المتصفّح (أربعةٌ) + ترشيحُ الباقة + **المجموعةُ المثبَّتةُ حيث وُجدت**.
  // 🔑 والقاعدةُ الحاكمة: عرضٌ له مجموعةٌ مثبَّتةٌ (`targetCount > 0`) لا يراه إلّا من هو فيها —
  //    وهو ما يُبقي كلَّ عرضٍ أُرسل قبل اليوم يعمل كما كان حرفاً بحرف. وما لا مجموعةَ له
  //    يحكمه الصنفُ والباقةُ وحدَهما.
  async function visibleOffers(): Promise<{ id: number; text: string | null; image: string | null }[]> {
    const scope = agentId == null ? {} : { agentId };
    const mine = subscriberId == null
      ? new Set<number>()
      : new Set((await prisma.agentOfferTarget.findMany({ where: { subscriberId }, select: { offerId: true } })).map((t) => t.offerId));
    const rows = await prisma.agentOffer.findMany({
      where: { ...scope, isDeleted: false, status: "visible" },
      select: { id: true, text: true, image: true, audience: true, packages: true, targetCount: true },
      orderBy: { id: "desc" },
      take: 200,
    });
    return rows
      .filter((o) => (o.targetCount > 0 ? mine.has(o.id) : true))
      .filter((o) => offerVisibleTo(o, klass, myPkg))
      .slice(0, 30)
      .map((o) => ({ id: o.id, text: o.text, image: o.image }));
  }

  // بلا وكيل (ضيفٌ/حسابُ غير مشتركٍ/مشتركٌ بلا مكتب) ⇒ الباقاتُ المنشورةُ لكلّ الوكلاء
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
    return NextResponse.json({ packages, offers: await visibleOffers() });
  }

  const published = await prisma.agentAppPackage.findMany({
    where: { agentId, visible: true },
    select: { packageId: true, note: true, sort: true },
  });

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
      current: p.id === myPackageId,
      sort: meta.get(p.id)?.sort ?? 0,
    }))
    .sort((a, b) => a.sort - b.sort || (a.price ?? 0) - (b.price ?? 0));

  return NextResponse.json({ packages, offers: await visibleOffers() });
}
