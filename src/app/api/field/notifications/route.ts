import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET: إشعارات وكيل المدير (الأحدث أولاً) + عدد غير المقروء. معزول بالوكيل.
//
// 🎯 **والمُخاطَبُ يُحترَم (طلبُ محمد 2026-08-14)**: إشعارٌ مُوجَّهٌ إلى شخصٍ بعينه
//   (`userId`) لا يراه غيرُه، والعامُّ (`userId = null`) يبقى للجميع كما كان.
//   فلو ظهر تكليفُ المديرِ لمستخدمٍ في قائمة الجميع لانتفت فائدةُ التوجيه.
//   ⚠️ ولا يُستثنى المديرُ من ذلك: هو يرى تكليفاتِه على **الحالة نفسِها** في لوحة
//   حارس المال («مُكلَّفٌ به فلان»)، فلا حاجةَ لإغراق قائمة إشعاراته بها.
export async function GET() {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  const me = g.session.userId ?? -1;
  // العامُّ + الموجَّهُ إليّ. والموجَّهُ إلى فنيٍّ لا يظهر هنا — مكانُه بطاقتُه في لوحته.
  const mine = { agentId, OR: [{ userId: null }, { userId: me }] };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: mine, orderBy: { id: "desc" }, take: 50 }),
    prisma.notification.count({ where: { ...mine, read: false } }),
  ]);
  return NextResponse.json({ notifications: items, unread });
}

// PATCH: وضع علامة «مقروء» (كلّها أو بمعرّفات محدّدة) ضمن وكيل المدير.
export async function PATCH(request: Request) {
  const g = await guard("field.manage");
  if (g.error) return g.error;
  const agentId = g.session.agentId ?? -1;
  const parsed = z.object({ ids: z.array(z.coerce.number()).optional() }).safeParse(await request.json().catch(() => ({})));
  const ids = parsed.success ? parsed.data.ids : undefined;
  const me = g.session.userId ?? -1;
  await prisma.notification.updateMany({
    // 🔒 ولا يُعلَّم إشعارُ غيري مقروءاً: نفسُ شرطِ القراءة حرفيّاً
    where: {
      agentId, read: false, OR: [{ userId: null }, { userId: me }],
      ...(ids && ids.length ? { id: { in: ids } } : {}),
    },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}
