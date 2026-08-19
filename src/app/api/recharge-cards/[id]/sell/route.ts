import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { getSession } from "@/lib/auth";

// وضع علامة "مُباع/مُستخدم" على الكرت
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard("inventory.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const { id } = await params;
  // 🔴 عالٍ · لا يُباع كارتٌ مستهلَكٌ سلفاً (اصطاده الفحصُ العدائيّ 2026-08-19):
  //   كان الشرطُ بلا `useDate: null` ⇒ كارتٌ بِيع/استُهلك يُباع ثانيةً بنجاحٍ صامت، وuseDate
  //   وuserName يُكتبان فوق القيمة الأصلية فيضيع مَن باعه ومتى، وزبونان يتسلّمان السيريالَ
  //   والساسُ يقبل أحدَهما ⇒ زبونٌ دفع مقابل سيريالٍ ميّت. الآن: الشرطُ ذرّيٌّ (كنمط التفعيل)
  //   يرفض المستهلَك بـ409. 🔒 العزلُ محفوظ (agentId من الجلسة).
  const res = await prisma.rechargeCard.updateMany({
    where: { id: Number(id), agentId: session?.agentId ?? -1, useDate: null },
    data: { useDate: new Date(), userName: session?.fullName ?? session?.username },
  });
  if (res.count === 0) {
    // نميّز: غيرُ موجود (404) أم مستهلَكٌ سلفاً (409)؟
    const exists = await prisma.rechargeCard.findFirst({ where: { id: Number(id), agentId: session?.agentId ?? -1 }, select: { useDate: true } });
    if (exists) return NextResponse.json({ error: "الكارتُ مُستهلَكٌ سلفاً (بِيع أو استُخدم في تفعيل) — لا يُباع ثانيةً" }, { status: 409 });
    return NextResponse.json({ error: "الكارت غير موجود ضمن حسابك" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
