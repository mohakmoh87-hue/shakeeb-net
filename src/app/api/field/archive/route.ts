import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isFieldManager } from "@/lib/field";
import { agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// أرشيف البطاقات المحصَّلة: تبقى أسبوعاً بعد التحصيل ثم تُحذف نهائياً (أو يحذفها المدير يدوياً).
// فلاتر: ?date=YYYY-MM-DD (يوم بغداد للإنجاز) و?technicianId= و?kind= — تُجمع معاً.
// العزل: مستخدم المكتب يرى أرشيف مكتبه؛ المدير أرشيف كل مكاتب وكيله.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const url = new URL(request.url);
  const date = (url.searchParams.get("date") ?? "").trim();
  const technicianId = Number(url.searchParams.get("technicianId")) || null;
  const kind = (url.searchParams.get("kind") ?? "").trim();
  const officeId = Number(url.searchParams.get("officeId")) || null; // فلتر مكتب (اختياري)

  // المكاتب المسموحة (عزل المستأجر) — وفلتر المكتب المطلوب ضمنها حصراً
  const allTowers = isFieldManager(session) ? await agentTowerIds(session) : (session.towerId != null ? [session.towerId] : []);
  const towers = officeId != null && allTowers.includes(officeId) ? [officeId] : allTowers;
  const boards = await prisma.taskBoard.findMany({ where: { towerId: { in: towers.length ? towers : [-1] } }, select: { id: true, towerId: true } });
  const lists = await prisma.taskList.findMany({ where: { boardId: { in: boards.map((b) => b.id) } }, select: { id: true, boardId: true } });
  const boardTower = new Map(boards.map((b) => [b.id, b.towerId]));
  const listTower = new Map(lists.map((l) => [l.id, boardTower.get(l.boardId) ?? null]));

  // فلتر يوم الإنجاز (بتوقيت بغداد)
  const dateWhere = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? { completedAt: { gte: new Date(`${date}T00:00:00+03:00`), lte: new Date(`${date}T23:59:59.999+03:00`) } }
    : {};

  const cards = await prisma.taskCard.findMany({
    where: {
      listId: { in: lists.length ? lists.map((l) => l.id) : [-1] },
      archivedAt: { not: null }, isDeleted: false,
      ...(technicianId ? { technicianId } : {}),
      ...(kind ? { kind } : {}),
      ...dateWhere,
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: 300,
    select: {
      id: true, listId: true, title: true, description: true, kind: true, assignee: true, technicianId: true,
      amount: true, subAmount: true, serviceDetails: true, durationSec: true, completedAt: true, archivedAt: true, history: true, createdAt: true,
    },
  });
  // أي بطاقة أرشيف لها صورة عمل محفوظة؟ (تبقى الصور حتى الحذف التلقائي بعد أسبوع)
  const photoRows = cards.length
    ? await prisma.cardPhoto.findMany({ where: { cardId: { in: cards.map((c) => c.id) } }, select: { cardId: true } })
    : [];
  const photoIds = new Set(photoRows.map((p) => p.cardId));

  const towersInfo = await prisma.tower.findMany({ where: { id: { in: towers.length ? towers : [-1] } }, select: { id: true, name: true } });
  const towerName = new Map(towersInfo.map((t) => [t.id, t.name]));

  // خيارات فلتر «الفني» من الأرشيف نفسه (ضمن النطاق المسموح، قبل فلتري الفني/النوع):
  // تشمل فنيي الدعم/المكاتب الأخرى الذين نفّذوا بطاقات هنا — لا فنيي المكتب الحاليين فقط
  const archTechs = await prisma.taskCard.findMany({
    where: { listId: { in: lists.length ? lists.map((l) => l.id) : [-1] }, archivedAt: { not: null }, isDeleted: false, technicianId: { not: null } },
    select: { technicianId: true, assignee: true },
    distinct: ["technicianId"],
  });
  const techOptions = archTechs
    .map((t) => ({ id: t.technicianId as number, name: t.assignee ?? `فني #${t.technicianId}` }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  return NextResponse.json({
    isManager: isFieldManager(session),
    techOptions,
    cards: cards.map((c) => ({
      ...c,
      hasPhoto: photoIds.has(c.id),
      office: (() => { const tid = listTower.get(c.listId); return tid != null ? towerName.get(tid) ?? null : null; })(),
    })),
  });
}

// استرجاع بطاقة من الأرشيف إلى عمودها السابق: تعود فعّالة (غير منجزة) ليتمكن الفني من
// العمل عليها مجدداً. ماليّات إنجازها الأول محفوظة أصلاً (فاتورة/تحصيل) ولا تُمَسّ —
// تُصفَّر مبالغها المعلوماتية كي لا تدخل التحصيل مرتين. متاحة لمستخدم المكتب والمدير (بعزل).
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });

  const card = await prisma.taskCard.findFirst({
    where: { id, archivedAt: { not: null }, isDeleted: false },
    select: { id: true, listId: true, title: true, subscriberId: true, assignee: true },
  });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة بالأرشيف" }, { status: 404 });

  // عزل: البطاقة يجب أن تتبع مكتباً يملكه المُشاهد (المدير: مكاتب وكيله؛ الموظف: مكتبه)
  const list = await prisma.taskList.findUnique({ where: { id: card.listId }, select: { boardId: true, isDeleted: true } });
  const board = list ? await prisma.taskBoard.findUnique({ where: { id: list.boardId }, select: { towerId: true } }) : null;
  const allTowers = isFieldManager(session) ? await agentTowerIds(session) : (session.towerId != null ? [session.towerId] : []);
  if (!board || board.towerId == null || !allTowers.includes(board.towerId)) {
    return NextResponse.json({ error: "البطاقة لا تتبع حسابك" }, { status: 403 });
  }
  if (!list || list.isDeleted) return NextResponse.json({ error: "عمود البطاقة الأصلي حُذف — لا يمكن استرجاعها" }, { status: 400 });

  // منع بطاقتين فعّالتين لنفس المشترك (نفس قاعدة الرفع من صفحة المشتركين)
  if (card.subscriberId) {
    const active = await prisma.taskCard.findFirst({
      where: { subscriberId: card.subscriberId, settled: false, isDeleted: false, id: { not: card.id } },
      select: { id: true, kind: true },
    });
    if (active) {
      return NextResponse.json({ error: `لهذا المشترك بطاقة فعّالة أخرى («${active.kind}» #${active.id}) — لا يمكن الاسترجاع قبل إكمالها` }, { status: 409 });
    }
  }

  // العودة للوحة: فعّالة من جديد في آخر العمود، بلا مبالغ (سُدّدت في تحصيل إنجازها الأول)
  const position = await prisma.taskCard.count({ where: { listId: card.listId, isDeleted: false, archivedAt: null } });
  await prisma.taskCard.update({
    where: { id: card.id },
    data: {
      archivedAt: null, settled: false, done: false, completedAt: null,
      startedAt: null, durationSec: null, postponedTo: null,
      amount: null, subAmount: null, serviceDetails: null, materialsInfo: null,
      position,
    },
  });
  const byName = session.fullName ?? session.username;
  const { appendCardHistory } = await import("@/lib/field");
  await appendCardHistory(card.id, byName, "↩️ إعادة البطاقة من الأرشيف إلى اللوحة");
  const { notify } = await import("@/lib/notify");
  void notify({
    agentId: session.agentId ?? null, towerId: board.towerId, type: "cardDone",
    title: "↩️ أُعيدت بطاقة من الأرشيف",
    body: `«${card.title}» عادت إلى اللوحة${card.assignee ? ` — الفني ${card.assignee}` : ""}`,
    refType: "card", refId: card.id, url: `/field-management?open=${card.id}`,
  });
  return NextResponse.json({ ok: true });
}

// حذف بطاقة من الأرشيف نهائياً — للمدير فقط (المستخدم العادي لا يستطيع)
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (!isFieldManager(session)) return NextResponse.json({ error: "حذف الأرشيف للمدير فقط" }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });

  // عزل المستأجر: البطاقة يجب أن تتبع أحد مكاتب وكيل المدير
  const card = await prisma.taskCard.findFirst({ where: { id, archivedAt: { not: null } }, select: { id: true, listId: true } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة بالأرشيف" }, { status: 404 });
  const list = await prisma.taskList.findUnique({ where: { id: card.listId }, select: { boardId: true } });
  const board = list ? await prisma.taskBoard.findUnique({ where: { id: list.boardId }, select: { towerId: true } }) : null;
  const towers = await agentTowerIds(session);
  if (!board || board.towerId == null || !towers.includes(board.towerId)) {
    return NextResponse.json({ error: "البطاقة لا تتبع حسابك" }, { status: 403 });
  }

  await prisma.$transaction([
    prisma.cardPhoto.deleteMany({ where: { cardId: id } }),
    prisma.taskCard.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
