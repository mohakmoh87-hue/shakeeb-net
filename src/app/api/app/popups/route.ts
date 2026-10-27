import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appAudience } from "@/lib/subscriberAuth";
import { ensureMarketTable } from "@/lib/market";

export const dynamic = "force-dynamic";

// 🪟 النوافذُ المنبثقةُ التي تُعرَض عند فتح التطبيق (طلبُ محمد 2026-10-25).
// جمهورُ كلٍّ منها: all | subs | guests — فيرى المشتركُ نوافذَه والزائرُ نوافذَه،
// 🔓 والصنفُ من `appAudience` لا من «له جلسةٌ أم لا» (قرارُ محمد 2026-10-27): المنتهي
// أكثرَ من شهرٍ يأخذ نوافذَ الزائر، فالثلاثةُ معاملةٌ واحدة.
// وقد تكون للاثنين نوافذُ مختلفةٌ في الوقت نفسِه. تُعرَض بالترتيب، واحدةً بعد أخرى.
// 🔒 لا بياناتِ مشتركٍ هنا إطلاقاً — محتوًى عامٌّ يضعه أدمن التطبيق.
export async function GET() {
  await ensureMarketTable();
  const { audience } = await appAudience();
  const rows = await prisma.appPopup.findMany({
    where: {
      isDeleted: false,
      status: "visible",
      audience: { in: ["all", audience] },
    },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    take: 30,
    select: { id: true, text: true, image: true, kind: true },
  });
  const usable = rows.filter((r) => (r.text ?? "").trim() || r.image);
  const pick = (k: string) => usable.filter((r) => r.kind === k).map((r) => ({ id: r.id, text: r.text, image: r.image }));
  return NextResponse.json({ items: pick("popup"), strip: pick("strip") });
}
