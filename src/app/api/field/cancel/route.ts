import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendCardHistory, resolveCardActor } from "@/lib/field";

export const dynamic = "force-dynamic";

// إلغاء بطاقة (طلب محمد 2026-07-29): خيار رابع بعد «بدء العمل» بجانب إنجاز/تأجيل/ميجاوب.
// - الملاحظة إلزامية — لا إلغاء بدونها (تُسجَّل في سجل تغييرات البطاقة).
// - تنتقل البطاقة إلى عمود «الغاء» (يُنشأ تلقائياً للوحة إن لم يوجد).
// - تُعلَّم settled=true: لا تدخل تحصيل الفنيين، ولا تحجب إنشاء بطاقة جديدة
//   لنفس المشترك (قيد «بطاقة فعّالة واحدة» يعتمد settled=false).
// الفاعل: مستخدم المكتب/المدير، أو الفني نفسه على بطاقته (نفس عزل التأجيل).
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const cardId = Number(b?.cardId);
  const note = typeof b?.note === "string" ? b.note.trim() : "";
  if (!cardId) return NextResponse.json({ error: "cardId مطلوب" }, { status: 400 });
  if (!note) return NextResponse.json({ error: "ملاحظة الإلغاء إلزامية — اكتب سبب الإلغاء" }, { status: 400 });

  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة" }, { status: 404 });
  if (card.done) return NextResponse.json({ error: "البطاقة منجزة — لا تُلغى" }, { status: 400 });
  const auth = await resolveCardActor(cardId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // شرط «بدء» قبل الإلغاء يخص الفني على غير التوصيل فقط:
  // التوصيل بلا «بدء» أصلاً (قاعدته الثابتة — طلب محمد)، والمكتب/المدير يُلغي قبل البدء
  const type = await prisma.cardType.findFirst({ where: { name: card.kind, isDeleted: false, agentId: auth.actor.agentId ?? -1 } });
  const isDelivery = type?.deliveryOnly ?? card.kind === "توصيل";
  if (!card.startedAt && !isDelivery && auth.actor.isTech) {
    return NextResponse.json({ error: "ابدأ البطاقة أولاً قبل الإلغاء" }, { status: 400 });
  }

  // عمود «الغاء» على نفس لوحة البطاقة — يُنشأ عند أول إلغاء
  const list = await prisma.taskList.findUnique({ where: { id: card.listId }, select: { boardId: true } });
  if (!list) return NextResponse.json({ error: "عمود البطاقة غير موجود" }, { status: 404 });
  let cancelList = await prisma.taskList.findFirst({
    where: { boardId: list.boardId, name: "الغاء", isDeleted: false },
    select: { id: true },
  });
  if (!cancelList) {
    const last = await prisma.taskList.findFirst({
      where: { boardId: list.boardId, isDeleted: false },
      orderBy: { position: "desc" }, select: { position: true },
    });
    cancelList = await prisma.taskList.create({
      data: { boardId: list.boardId, name: "الغاء", position: (last?.position ?? 0) + 1 },
      select: { id: true },
    });
  }

  // آخر موضع في عمود الإلغاء
  const lastCard = await prisma.taskCard.findFirst({
    where: { listId: cancelList.id, isDeleted: false },
    orderBy: { position: "desc" }, select: { position: true },
  });

  const updated = await prisma.taskCard.update({
    where: { id: cardId },
    data: {
      listId: cancelList.id,
      position: (lastCard?.position ?? 0) + 1,
      startedAt: null,      // المدة لا تُحتسب على الملغاة
      postponedTo: null,
      settled: true,        // خارج التحصيل، ولا تحجب بطاقة جديدة للمشترك
    },
  });
  await appendCardHistory(cardId, auth.actor.name, `إلغاء البطاقة — ${note}`);
  try { const { notifySubscriberCardEvent } = await import("@/lib/subscriberCardNotify"); void notifySubscriberCardEvent(cardId, "🚫 أُلغي طلبُك"); } catch { /* لا يُفشل العملية */ }
  return NextResponse.json(updated);
}
