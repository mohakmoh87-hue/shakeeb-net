import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { viewerScope } from "@/lib/viewerScope";
import { testSubscriberIds } from "@/lib/appTestUsers";

export const dynamic = "force-dynamic";

// 👁️ قائمةُ مشتركي المشاهد — نسخةٌ مجرَّدةٌ من `/api/subscribers` لا تعديلٌ عليه.
// 🔴 **الهاتفُ لا يُسحب من القاعدة إطلاقاً**: ليس في `select`، فلا يُخفى بالعرض بل
//    لا يوجد في الجواب. والبحثُ بالاسم واليوزر **فقط** — فلا يُستنتَج رقمٌ بالبحث عنه
//    (مسارُ المشتركين الأصليُّ يبحث بالهاتف والعنوان، وهذا لا).
// و`dateTo` (تاريخُ انتهاء اشتراك المشترك) مُنتقىً لعرض «المتبقي» كما في البرنامج (طلبُ محمد 2026-11-21).
const LIMIT = 300;

export async function GET(request: Request) {
  const sc = await viewerScope();
  if (!sc) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });

  const q = new URL(request.url).searchParams.get("q")?.trim();
  const hiddenTest = await testSubscriberIds();
  const where = {
    isDeleted: false,
    towerId: { in: sc.towerIds },
    ...(hiddenTest.length ? { id: { notIn: hiddenTest } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { netUser: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.subscriber.findMany({
      where,
      select: { id: true, name: true, netUser: true, towerId: true, dateTo: true },
      orderBy: { name: "asc" },
      take: LIMIT,
    }),
    prisma.subscriber.count({ where: { isDeleted: false, towerId: { in: sc.towerIds } } }),
  ]);

  // مكاتبُ نطاقه تُرسَل **دائماً** مع القائمة: خانةُ «المكتب» لمن نطاقُه كلُّ المكاتب،
  // ومكتبُ البطاقة الحرّة لمن نطاقُه مكتبٌ واحد — فلا يُستنتَج المكتبُ من أوّل مشترك
  // (قائمةٌ فارغةٌ أو بحثٌ لا نتيجةَ له كان سيترك البطاقةَ الحرّة بلا مكتب).
  const offices = await prisma.tower.findMany({
    where: { id: { in: sc.towerIds } }, select: { id: true, name: true }, orderBy: { id: "asc" },
  });

  return NextResponse.json(
    { items, offices, allOffices: sc.viewer.viewAllOffices, name: sc.viewer.name },
    { headers: { "X-Total-Count": String(total), "X-Limit": String(LIMIT) } },
  );
}
