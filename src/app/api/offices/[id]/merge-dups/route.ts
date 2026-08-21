import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { mergeDuplicateNetUsers } from "@/lib/subscriptionSync";

export const dynamic = "force-dynamic";

// ═════ 🔗 دمجُ المكرَّرين على اليوزر — تشغيلٌ مباشرٌ بتقريرٍ صريح (2026-08-21) ═════
// الدمجُ يعمل أصلاً في بداية كلّ مزامنة، لكنّ نتيجتَه كانت **صامتة**: حين لا يتغيّر شيء
// لا يُعرف أهو «لا مكرَّرَ أصلاً» أم «تُركت لمالٍ في الصفَّين» أم «عطلٌ ابتلعه catch».
// هذا المسارُ يشغّله وحدَه ويعيد التقريرَ كاملاً — فيُقاس بدل أن يُظنّ.
// 🔒 بصلاحيّة `offices.sync` وبعزلِ الوكيل (مكتبٌ من مكاتبه حصراً).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("offices.sync");
  if (g.error) return g.error;
  const { id } = await params;
  const towerId = Number(id);
  const mine = await agentTowerIds(g.session ?? null);
  if (!mine.includes(towerId)) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  const report = await mergeDuplicateNetUsers(towerId);
  return NextResponse.json({ ok: true, towerId, ...report });
}
