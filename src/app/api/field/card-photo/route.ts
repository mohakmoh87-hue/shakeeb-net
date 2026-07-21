import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { agentOwnsCard } from "@/lib/field";

export const dynamic = "force-dynamic";

// جلب صورة عمل البطاقة (للعرض والتحميل على الحاسبة).
// المستخدم: بطاقات وكيله؛ الفني: بطاقته المسندة إليه فقط.
export async function GET(request: Request) {
  const cardId = Number(new URL(request.url).searchParams.get("cardId"));
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });

  const session = await getSession();
  if (session) {
    if (!(await agentOwnsCard(session, cardId))) return NextResponse.json({ error: "البطاقة لا تتبع حسابك" }, { status: 403 });
  } else {
    const tech = await getTechSession();
    if (!tech) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
    const card = await prisma.taskCard.findUnique({ where: { id: cardId }, select: { technicianId: true } });
    if (card?.technicianId !== tech.technicianId) return NextResponse.json({ error: "البطاقة ليست مسندة إليك" }, { status: 403 });
  }

  const photo = await prisma.cardPhoto.findUnique({ where: { cardId }, select: { data: true } });
  if (!photo?.data) return NextResponse.json({ error: "لا صورة لهذه البطاقة" }, { status: 404 });
  return NextResponse.json({ photo: photo.data });
}
