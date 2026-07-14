import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// بدء العمل على بطاقة — يسجّل وقت البدء (ويُظهر محتواها) ويبدأ احتساب المدة.
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  const cardId = Number(b?.cardId);
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة" }, { status: 400 });

  // يبدأ الاحتساب من جديد (يلغي أي تأجيل سابق)
  const updated = await prisma.taskCard.update({
    where: { id: cardId },
    data: { startedAt: new Date(), postponedTo: null },
  });
  return NextResponse.json(updated);
}
