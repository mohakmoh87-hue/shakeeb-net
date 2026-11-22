import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower } from "@/lib/guard";
import { phoneCore } from "@/lib/subscriberLogin";

export const dynamic = "force-dynamic";

const LIMIT = 10; // طلبُ محمد: آخرُ عشرة فحوص. والتخزينُ كاملٌ — هذا حدُّ عرضٍ لا حدُّ حفظ.

// 🩺 سجلُّ فحوص المشترك (بجانب سجلّ الوصولات) — ما قاسه بنفسه من تطبيق المشتركين.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const { id } = await params;
  const subscriberId = Number(id);
  if (!subscriberId) return NextResponse.json({ checks: [] });

  // عزلٌ بين المكاتب: لا يُقرأ سجلُّ مشترك مكتبٍ آخر — نفسُ حارس سجلّ الصيانات
  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, select: { towerId: true, phone: true } });
  if (!sub || !(await sameAgentTower(g.session, sub.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  // 🔑 صفوفُه بمعرّفه، **ومعها** فحوصُ ما قبل اشتراكه (بلا معرّفٍ وبهاتفه نفسِه) —
  //    فمَن فحص وهو غيرُ مشتركٍ ثمّ اشترك يظهر تاريخُه. ولا تختلط فحوصُ مشترِكَين
  //    يتشاركان رقماً، لأنّ صفَّ المشترك يحمل معرّفَه لا هاتفَه وحدَه.
  const core = phoneCore(sub.phone ?? "");
  const checks = await prisma.diagCheck.findMany({
    where: core
      ? { OR: [{ subscriberId }, { subscriberId: null, phoneCore: core }] }
      : { subscriberId },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });

  return NextResponse.json({ checks });
}
