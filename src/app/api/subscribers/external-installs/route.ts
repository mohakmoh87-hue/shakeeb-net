import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardAny, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ═════ البند ٥ · «تنصيبات خارجية» — ما نصّبته الشركةُ بلا علمِ محمد ═════
//
// طلبُه بنصّه: «أريد معرفةَ كم مشتركاً قامت الشركةُ بتنصيبه بلا علمي، ويمكنني تحديدُ ما
// أشاء من هذه القائمة واختيارُ **تجاهل** لمسحهم منها — **وهذه القائمةُ للاطّلاع فقط
// وليس شيءٌ آخر**».
//
// 🔑 و«للاطّلاع فقط» **قيدٌ في التصميم لا وصفٌ**: هذا المسارُ لا يُنشئ مشتركاً ولا يحذفه
//   ولا يمسّ ديناً ولا تاريخاً. و«تجاهل» يكتب **وسماً واحداً** (`extIgnoredAt`) يُخرجه من
//   القائمة — والمشتركُ يبقى كما هو تماماً. فلا زرَّ في هذه الصفحة يُغيّر مالاً أو خدمة.
//
// 🔴 ولماذا لا يكفي `createdByUser='sync'`؟ قِيس: **١٩٤٩١** مشتركاً أنشأتهم المزامنة،
//   وأكثرُهم استيرادُ النقل الأوّل. فالقائمةُ تُبنى على `extInstallAt` الذي **يُوسَم من
//   لحظة نشر هذا البند فصاعداً** — تبدأ فارغةً وتمتلئ بما هو خبرٌ فعلاً.

const ignoreSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
});

/** مكاتبُ الوكيل المسموحةُ لهذا المستخدم — 🔒 نقطةُ العزل الوحيدة، تُستعمل في المسارَين. */
async function scope(session: Parameters<typeof agentTowerIds>[0], officeId: number | null) {
  const mine = await agentTowerIds(session);
  if (officeId != null) {
    if (!mine.includes(officeId)) return null; // مكتبٌ لا يتبع الوكيل
    return [officeId];
  }
  return mine.length ? mine : [-1];
}

export async function GET(request: Request) {
  const g = await guardAny("subscribers.manage", "subscribers.import");
  if (g.error) return g.error;
  const sp = new URL(request.url).searchParams;
  const officeId = Number(sp.get("officeId")) || null;
  const towers = await scope(g.session ?? null, officeId);
  if (!towers) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  const rows = await prisma.subscriber.findMany({
    where: {
      isDeleted: false,
      towerId: { in: towers },
      extInstallAt: { not: null }, // رصدَته المزامنةُ بعد نشر البند
      extIgnoredAt: null,          // ولم يُتجاهَل
    },
    select: {
      id: true, name: true, netUser: true, phone: true, dateTo: true,
      towerId: true, extInstallAt: true, packageId: true,
    },
    orderBy: { extInstallAt: "desc" },
    take: 500,
  });

  const oNames = new Map(
    (await prisma.tower.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.towerId).filter((x): x is number => x != null))] } },
      select: { id: true, name: true },
    })).map((o) => [o.id, o.name]),
  );
  const pkgs = new Map(
    (await prisma.package.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.packageId).filter((x): x is number => x != null))] } },
      select: { id: true, name: true },
    })).map((p) => [p.id, p.name]),
  );

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id, name: r.name, netUser: r.netUser, phone: r.phone, dateTo: r.dateTo,
      office: r.towerId != null ? (oNames.get(r.towerId) ?? null) : null,
      package: r.packageId != null ? (pkgs.get(r.packageId) ?? null) : null,
      foundAt: r.extInstallAt,
    })),
  });
}

// «تجاهل» — يُخرج المشتركَ من القائمة ولا يمسّه بشيءٍ آخر
export async function POST(request: Request) {
  const g = await guardAny("subscribers.manage", "subscribers.import");
  if (g.error) return g.error;
  const parsed = ignoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });

  const towers = await scope(g.session ?? null, null);
  if (!towers) return NextResponse.json({ error: "لا مكاتب" }, { status: 403 });

  // 🔒 العزلُ في **جملة التحديث نفسِها**: `towerId in mine` شرطٌ لا فحصٌ سابق — فمعرّفٌ
  //   لمشترك وكيلٍ آخرَ يُمرَّر في الطلب لا يُصيب صفّاً واحداً.
  // ⚠️ ولا يُمسّ إلّا الوسم: لا حذفٌ ولا تعديلُ تاريخٍ ولا دين («للاطّلاع فقط»).
  const upd = await prisma.subscriber.updateMany({
    where: { id: { in: parsed.data.ids }, towerId: { in: towers }, isDeleted: false, extIgnoredAt: null },
    data: { extIgnoredAt: new Date() },
  });
  return NextResponse.json({ ok: true, ignored: upd.count });
}
