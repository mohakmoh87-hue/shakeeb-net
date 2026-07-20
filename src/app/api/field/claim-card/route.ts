import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTechSession } from "@/lib/auth";
import { appendCardHistory, cardOfficeId } from "@/lib/field";

export const dynamic = "force-dynamic";

// تحويل بطاقة على الفني نفسه: الفني يأخذ بطاقةً غير مُسندة (يستلمها)
// أو مسندة لفنيٍّ آخر في نفس مكتبه (يحوّلها لنفسه).
// عزل صارم: البطاقة يجب أن تكون في مكتب الفني، وغير منجزة.
export async function POST(request: Request) {
  const tech = await getTechSession();
  if (!tech) return NextResponse.json({ error: "دخول الفني مطلوب" }, { status: 401 });

  const cardId = Number((await request.json().catch(() => null))?.cardId);
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });

  const card = await prisma.taskCard.findFirst({
    where: { id: cardId, isDeleted: false },
    select: { id: true, technicianId: true, done: true, assignee: true },
  });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة" }, { status: 400 });

  // العزل: البطاقة يجب أن تتبع مكتب الفني نفسه (عبر لوحة مكتبه)
  const office = await cardOfficeId(cardId);
  if (office == null || office !== (tech.towerId ?? null)) {
    return NextResponse.json({ error: "البطاقة ليست في مكتبك" }, { status: 403 });
  }
  // شرط الطلب: غير مُسندة (يستلمها) أو مُسندة لفنيٍّ آخر (يحوّلها لنفسه) — لا إن كانت عليه أصلاً
  if (card.technicianId === tech.technicianId) return NextResponse.json({ error: "البطاقة عليك أصلاً" }, { status: 400 });

  // تأكيد أن الفني الحالي للبطاقة يتبع نفس المكتب (عزل إضافي)
  const me = await prisma.technician.findFirst({
    where: { id: tech.technicianId, isDeleted: false },
    select: { id: true, name: true, towerId: true },
  });
  if (!me || me.towerId !== (tech.towerId ?? null)) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  }

  const updated = await prisma.taskCard.update({
    where: { id: cardId },
    data: { technicianId: me.id, assignee: me.name },
    select: { id: true, technicianId: true, assignee: true },
  });
  // سجل التغييرات: استلام بطاقة غير مُسندة أو تحويلها من الفني السابق
  await appendCardHistory(cardId, me.name, card.technicianId == null
    ? `استلام البطاقة (كانت بلا فني) بواسطة «${me.name}»`
    : `تحويل البطاقة من «${card.assignee ?? "فني"}» إلى «${me.name}»`);
  return NextResponse.json({ ok: true, card: updated });
}
