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
      amount: true, subAmount: true, serviceDetails: true, durationSec: true, completedAt: true, archivedAt: true, history: true,
    },
  });

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
      office: (() => { const tid = listTower.get(c.listId); return tid != null ? towerName.get(tid) ?? null : null; })(),
    })),
  });
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
