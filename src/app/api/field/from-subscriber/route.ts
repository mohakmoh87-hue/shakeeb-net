import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getOrCreateBoard } from "@/lib/field";

export const dynamic = "force-dynamic";

// خيارات العمليات المسموحة — كل خيار يقابل عموداً في لوحة إدارة الفنيين بنفس الاسم
const OPERATIONS = ["صيانة", "اعادة", "توصيل", "تحويل"] as const;

// إنشاء بطاقة في لوحة إدارة الفنيين انطلاقاً من مشترك:
// يأخذ معلومات المشترك (الاسم، الهاتف، اليوزر) ويضعها في العمود الذي يحمل اسم
// العملية المختارة، ويُنشئ العمود تلقائياً إن لم يكن موجوداً.
export async function POST(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const subscriberId = Number(body?.subscriberId);
  const operation = String(body?.operation ?? "").trim();
  if (!subscriberId) return NextResponse.json({ error: "معرّف المشترك مطلوب" }, { status: 400 });
  if (!OPERATIONS.includes(operation as (typeof OPERATIONS)[number])) {
    return NextResponse.json({ error: "عملية غير معروفة" }, { status: 400 });
  }

  const sub = await prisma.subscriber.findFirst({
    where: { id: subscriberId, isDeleted: false },
    select: { id: true, name: true, phone: true, netUser: true, towerId: true },
  });
  if (!sub || !ownsTower(g.session, sub.towerId)) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  // لوحة إدارة الفنيين الخاصّة بمكتب المشترك (مستقلّة لكل مكتب، تُنشأ إن لم توجد)
  const board = await getOrCreateBoard(sub.towerId ?? null);

  // العمود الذي يحمل اسم العملية — يُنشأ إن لم يوجد
  let list = await prisma.taskList.findFirst({
    where: { boardId: board.id, name: operation, isDeleted: false },
    orderBy: { position: "asc" },
  });
  if (!list) {
    const count = await prisma.taskList.count({ where: { boardId: board.id, isDeleted: false } });
    list = await prisma.taskList.create({ data: { boardId: board.id, name: operation, position: count } });
  }

  // البطاقة: الاسم عنواناً، والهاتف واليوزر في الوصف
  const title = sub.name?.trim() || sub.netUser?.trim() || `مشترك #${sub.id}`;
  const descLines = [
    `📱 الهاتف: ${sub.phone?.trim() || "—"}`,
    `👤 اليوزر: ${sub.netUser?.trim() || "—"}`,
  ];
  const position = await prisma.taskCard.count({ where: { listId: list.id, isDeleted: false } });
  const card = await prisma.taskCard.create({
    // نوع البطاقة يُؤخذ تلقائياً من العملية (توصيل/تحويل/صيانة/اعادة)
    data: { listId: list.id, title, description: descLines.join("\n"), position, kind: operation },
  });

  return NextResponse.json({ ok: true, listName: list.name, card }, { status: 201 });
}
