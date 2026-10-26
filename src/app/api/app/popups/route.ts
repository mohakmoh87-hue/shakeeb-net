import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { ensureMarketTable } from "@/lib/market";

export const dynamic = "force-dynamic";

// 🪟 النوافذُ المنبثقةُ التي تُعرَض عند فتح التطبيق (طلبُ محمد 2026-10-25).
// جمهورُ كلٍّ منها: all | subs | guests — فيرى المشتركُ نوافذَه والزائرُ نوافذَه،
// وقد تكون للاثنين نوافذُ مختلفةٌ في الوقت نفسِه. تُعرَض بالترتيب، واحدةً بعد أخرى.
// 🔒 لا بياناتِ مشتركٍ هنا إطلاقاً — محتوًى عامٌّ يضعه أدمن التطبيق.
export async function GET() {
  await ensureMarketTable();
  const sess = await getSubscriberSession();
  const isSub = sess != null;
  const rows = await prisma.appPopup.findMany({
    where: {
      isDeleted: false,
      status: "visible",
      audience: { in: ["all", isSub ? "subs" : "guests"] },
    },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    take: 30,
    select: { id: true, text: true, image: true, kind: true },
  });
  const usable = rows.filter((r) => (r.text ?? "").trim() || r.image);
  const pick = (k: string) => usable.filter((r) => r.kind === k).map((r) => ({ id: r.id, text: r.text, image: r.image }));
  return NextResponse.json({ items: pick("popup"), strip: pick("strip") });
}
