import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendCardHistory, resolveCardActor } from "@/lib/field";

export const dynamic = "force-dynamic";

// بدء العمل على بطاقة — يسجّل وقت البدء (ويُظهر محتواها) ويبدأ احتساب المدة.
// الفاعل: مستخدم المكتب/المدير، أو الفني نفسه على بطاقته المسندة إليه (بعزل صارم).
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const cardId = Number(b?.cardId);
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة" }, { status: 400 });
  const auth = await resolveCardActor(cardId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // الفني: بطاقة جارية واحدة فقط — لا «بدء» لبطاقة ثانية حتى يُنهي الأولى
  // (إنجاز أو تأجيل أو ميجاوب). المدير/المستخدم غير مقيّدين.
  if (auth.actor.isTech && auth.actor.technicianId != null) {
    const running = await prisma.taskCard.findFirst({
      where: {
        technicianId: auth.actor.technicianId, done: false, isDeleted: false,
        startedAt: { not: null }, postponedTo: null, id: { not: cardId },
      },
      select: { title: true },
    });
    if (running) {
      return NextResponse.json({ error: `لديك بطاقة جارية «${running.title}» — أنجزها أو أجّلها أو اضغط «ميجاوب» قبل بدء بطاقة أخرى` }, { status: 400 });
    }
  }

  // يبدأ الاحتساب من جديد (يلغي أي تأجيل سابق)
  const updated = await prisma.taskCard.update({
    where: { id: cardId },
    data: { startedAt: new Date(), postponedTo: null },
  });
  await appendCardHistory(cardId, auth.actor.name, "بدء العمل على البطاقة");
  return NextResponse.json(updated);
}
