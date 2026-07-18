import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canOperateCard } from "@/lib/field";

export const dynamic = "force-dynamic";

// تأجيل بطاقة (المشترك غير متواجد) — يجب تحديد موعد، وتعود البطاقة للانتظار لحين الموعد.
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
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
  if (!(await canOperateCard(s, cardId))) return NextResponse.json({ error: "مشاهدة فقط — لا يمكنك التعديل على مكتب آخر" }, { status: 403 });
  if (!card.startedAt) return NextResponse.json({ error: "ابدأ البطاقة أولاً قبل التأجيل" }, { status: 400 });

  // يُلغى وقت البدء (المدة لا تُحتسب على التأجيل) ويُسجَّل الموعد الجديد
  const updated = await prisma.taskCard.update({
    where: { id: cardId },
    data: { startedAt: null, postponedTo: postponeTo },
  });
  return NextResponse.json(updated);
}
