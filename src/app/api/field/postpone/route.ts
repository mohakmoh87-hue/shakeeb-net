import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendCardHistory, resolveCardActor } from "@/lib/field";

// تنسيق وقت بغداد للعرض في سجل التغييرات (dd/MM HH:mm)
const fmtBg = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const dynamic = "force-dynamic";

// تأجيل بطاقة (المشترك غير متواجد) — يجب تحديد موعد، وتعود البطاقة للانتظار لحين الموعد.
// الفاعل: مستخدم المكتب/المدير، أو الفني نفسه على بطاقته المسندة إليه (بعزل صارم).
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const cardId = Number(b?.cardId);
  const postponeTo = b?.postponeTo ? new Date(b.postponeTo) : null;
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });
  if (!postponeTo || isNaN(postponeTo.getTime())) {
    return NextResponse.json({ error: "حدّد موعد التأجيل (تاريخ ووقت)" }, { status: 400 });
  }

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة" }, { status: 400 });
  const auth = await resolveCardActor(cardId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!card.startedAt) return NextResponse.json({ error: "ابدأ البطاقة أولاً قبل التأجيل" }, { status: 400 });

  // يُلغى وقت البدء (المدة لا تُحتسب على التأجيل) ويُسجَّل الموعد الجديد
  const updated = await prisma.taskCard.update({
    where: { id: cardId },
    data: { startedAt: null, postponedTo: postponeTo },
  });
  // سجل التغييرات داخل البطاقة: من أجّل وإلى متى
  await appendCardHistory(cardId, auth.actor.name, `تأجيل البطاقة إلى ${fmtBg(postponeTo)}`);
  return NextResponse.json(updated);
}
