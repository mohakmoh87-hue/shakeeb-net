import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { cleanPhoto } from "@/lib/market";
import { ensureAgentAppTables, targetWindow, targetedSubscriberIds, cleanClasses, cleanPackageIds } from "@/lib/agentAppOffers";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 🎁 العروضُ الخاصّة — نصٌّ فقط، أو صورةٌ فقط، أو الاثنان؛ لمشتركٍ أو لمجموعةٍ تُحدَّد
// بتاريخ الانتهاء بين تاريخَين (طلبُ محمد 2026-10-24). معزولٌ كلُّه بـagentId.
// 🔓 والجمهورُ يُختار (طلبُ محمد 2026-10-27): `subs` المجموعةُ بتاريخ الانتهاء كما كان ·
// `guests` غيرُ المشتركين والمنتهون أكثرَ من شهرٍ والزوّار · `all` الجميع. وتاريخا
// الاستهدافِ والمجموعةُ المثبَّتةُ لا معنى لهما إلّا في `subs`.
export async function GET(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentAppTables();
  const url = new URL(request.url);

  // معاينةُ الجمهور قبل الإرسال: كم مشتركاً ينتهي بين التاريخَين (بمكاتب وكيلك وحدَها)
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (url.searchParams.get("preview") === "1") {
    if (!DAY.test(from) || !DAY.test(to) || !targetWindow(from, to)) {
      return NextResponse.json({ error: "تاريخان غير صحيحَين" }, { status: 400 });
    }
    const towerIds = await agentTowerIds(g.session);
    const ids = await targetedSubscriberIds(towerIds, from, to);
    const sample = ids.length
      ? await prisma.subscriber.findMany({
          where: { id: { in: ids.slice(0, 8) } },
          select: { name: true, netUser: true, dateTo: true },
          orderBy: { dateTo: "asc" },
        })
      : [];
    return NextResponse.json({ count: ids.length, sample });
  }

  const rows = await prisma.agentOffer.findMany({
    where: { agentId, isDeleted: false },
    orderBy: { id: "desc" },
    take: 100,
  });
  return NextResponse.json({
    items: rows.map((o) => ({
      id: o.id, text: o.text, image: o.image, status: o.status, audience: o.audience, packages: o.packages,
      targetFrom: o.targetFrom, targetTo: o.targetTo, targetCount: o.targetCount,
      createdBy: o.createdBy, createdAt: o.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId;
  if (agentId == null) return NextResponse.json({ error: "لا وكيلَ لهذه الجلسة" }, { status: 400 });
  await ensureAgentAppTables();
  const b = await request.json().catch(() => null);

  const text = typeof b?.text === "string" ? b.text.trim().slice(0, 1000) : "";
  const image = cleanPhoto(b?.image);
  if (!text && !image) return NextResponse.json({ error: "اكتب نصَّ العرض أو أضِف صورةً (أو الاثنين)" }, { status: 400 });

  // 🎯 الجمهورُ قائمةُ أصنافٍ (طلبُ محمد 2026-10-28)، والقديمُ `audience` المفردُ يُقبَل كما هو
  const audience = cleanClasses(b?.audiences ?? b?.audience) || "sub_active";
  const packages = cleanPackageIds(b?.packageIds);

  // 🗓️ تثبيتُ مجموعةٍ بتاريخ الانتهاء **اختياريٌّ الآن**: يُطلَب بإرسال التاريخَين. وبدونه
  //    يُحكَم العرضُ بالصنف والباقة وحدَهما (ولا مجموعةَ تُثبَّت) — وهو ما يلزم للزوّار
  //    وغير المشتركين أصلاً، فلا تاريخَ انتهاءٍ لهم.
  const from = typeof b?.from === "string" ? b.from : "";
  const to = typeof b?.to === "string" ? b.to : "";
  if (!from && !to) {
    const o = await prisma.agentOffer.create({
      data: {
        agentId, text: text || null, image, audience, packages, targetCount: 0,
        status: "visible", createdBy: g.session.fullName ?? g.session.username ?? null,
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: o.id, count: 0, audience }, { status: 201 });
  }
  if (!DAY.test(from) || !DAY.test(to)) return NextResponse.json({ error: "حدّد تاريخَي الانتهاء" }, { status: 400 });
  const w = targetWindow(from, to);
  if (!w) return NextResponse.json({ error: "تاريخُ البداية بعد تاريخ النهاية" }, { status: 400 });

  // 🔒 الجمهورُ من مكاتب وكيل الجلسة حصراً — ولا يُقبَل أيُّ معرّفٍ من الطلب
  const towerIds = await agentTowerIds(g.session);
  let ids = await targetedSubscriberIds(towerIds, from, to);
  // اختيارٌ يدويٌّ داخل المجموعة المعروضة (تحديدُ محمد): يُقصَر على جمهورها لا غير
  if (Array.isArray(b?.subscriberIds) && b.subscriberIds.length) {
    const picked = new Set((b.subscriberIds as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n)));
    ids = ids.filter((id) => picked.has(id));
  }
  if (ids.length === 0) return NextResponse.json({ error: "لا مشتركَ ينتهي اشتراكُه في هذه الفترة" }, { status: 400 });

  const offer = await prisma.$transaction(async (t) => {
    const o = await t.agentOffer.create({
      data: {
        agentId, text: text || null, image, audience, packages,
        targetFrom: w.gte, targetTo: w.lte, targetCount: ids.length,
        status: "visible", createdBy: g.session.fullName ?? g.session.username ?? null,
      },
      select: { id: true },
    });
    // الجمهورُ يُثبَّت الآن: تجديدُ المشترك يغيّر تاريخَه ولا يُخرجه من عرضٍ أُرسل إليه
    await t.agentOfferTarget.createMany({ data: ids.map((subscriberId) => ({ offerId: o.id, subscriberId })) });
    return o;
  });
  return NextResponse.json({ ok: true, id: offer.id, count: ids.length, audience }, { status: 201 });
}

// إخفاءٌ/إظهار — ولا حذفَ نهائيّ: الأرشفةُ بـisDeleted ويبقى الصفُّ وجمهورُه
export async function PATCH(request: Request) {
  const g = await guard("store.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  await ensureAgentAppTables();
  const b = await request.json().catch(() => null);
  const id = Number(b?.id) || 0;
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const own = await prisma.agentOffer.findFirst({ where: { id, agentId, isDeleted: false }, select: { id: true } });
  if (!own) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (b?.archive === true) {
    await prisma.agentOffer.update({ where: { id }, data: { isDeleted: true } });
    return NextResponse.json({ ok: true, archived: true });
  }
  const status = b?.status === "hidden" ? "hidden" : "visible";
  await prisma.agentOffer.update({ where: { id }, data: { status } });
  return NextResponse.json({ ok: true, status });
}
