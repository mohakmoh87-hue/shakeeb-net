import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isFieldManager, appendCardHistory } from "@/lib/field";
import { agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ===== سلّة محذوفات البطاقات (طلب محمد 2026-08-05) =====
// حذف البطاقة كان **ناعماً** في القاعدة (isDeleted) لكن بلا شاشة تعرضه ولا زرّ يُرجعه —
// فالمحذوف يختفي كأنه مُحي، ولا سبيل لتصحيح ضغطةٍ خاطئة إلا بتدخّل على القاعدة نفسها.
// الآن: تُعرض المحذوفة وتُسترجَع إلى **عمودها الأصلي** بضغطة.
//
// ⚠️ ما لا يعود: **صور البطاقة** — تُمحى من القاعدة لحظة الحذف (لا حذف ناعم لها).

// وقت الحذف تقريباً = آخر تعديل على الصفّ (الحذف آخر ما جرى عليه، ولا يُعدَّل بعده)
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const officeId = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const allTowers = isFieldManager(session) ? await agentTowerIds(session) : (session.towerId != null ? [session.towerId] : []);
  const towers = officeId != null && allTowers.includes(officeId) ? [officeId] : allTowers;

  const boards = await prisma.taskBoard.findMany({ where: { towerId: { in: towers.length ? towers : [-1] } }, select: { id: true, towerId: true } });
  const lists = await prisma.taskList.findMany({ where: { boardId: { in: boards.map((b) => b.id) } }, select: { id: true, name: true, boardId: true, isDeleted: true } });
  const listById = new Map(lists.map((l) => [l.id, l]));
  const boardTower = new Map(boards.map((b) => [b.id, b.towerId]));

  const cards = await prisma.taskCard.findMany({
    where: { listId: { in: lists.length ? lists.map((l) => l.id) : [-1] }, isDeleted: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true, listId: true, title: true, description: true, kind: true, assignee: true, technicianId: true,
      subscriberId: true, done: true, settled: true, amount: true, subAmount: true, updatedAt: true, createdAt: true,
    },
  });

  const towersInfo = await prisma.tower.findMany({ where: { id: { in: towers.length ? towers : [-1] } }, select: { id: true, name: true } });
  const towerName = new Map(towersInfo.map((t) => [t.id, t.name]));

  return NextResponse.json({
    rows: cards.map((c) => {
      const l = listById.get(c.listId);
      const tw = l ? boardTower.get(l.boardId) ?? null : null;
      return {
        id: c.id,
        title: c.title,
        kind: c.kind,
        assignee: c.assignee,
        listName: l?.name ?? null,
        listGone: !l || l.isDeleted, // عمودها الأصلي حُذف ⇒ لا استرجاع
        office: tw != null ? towerName.get(tw) ?? null : null,
        done: c.done,
        settled: c.settled,
        // ما سيعود إلى تحصيل الفني لو استُرجعت (منجزة غير محصَّلة فقط)
        backToSettlement: c.done && !c.settled ? (c.amount ?? 0) + (c.subAmount ?? 0) : 0,
        deletedAt: c.updatedAt,
        createdAt: c.createdAt,
      };
    }),
  });
}

// استرجاع بطاقة محذوفة إلى عمودها الأصلي
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });

  const card = await prisma.taskCard.findFirst({ where: { id, isDeleted: true } });
  if (!card) return NextResponse.json({ error: "البطاقة غير موجودة في المحذوفات" }, { status: 404 });

  // عزل: عمود البطاقة يجب أن يتبع مكاتب المستخدم
  const list = await prisma.taskList.findUnique({ where: { id: card.listId }, select: { id: true, name: true, boardId: true, isDeleted: true } });
  const board = list ? await prisma.taskBoard.findUnique({ where: { id: list.boardId }, select: { towerId: true } }) : null;
  const allTowers = isFieldManager(session) ? await agentTowerIds(session) : (session.towerId != null ? [session.towerId] : []);
  if (!board?.towerId || !allTowers.includes(board.towerId)) {
    return NextResponse.json({ error: "البطاقة لا تتبع حسابك" }, { status: 403 });
  }
  if (!list || list.isDeleted) {
    return NextResponse.json({ error: "عمود البطاقة الأصلي حُذف — لا يمكن استرجاعها" }, { status: 400 });
  }

  // نفس قاعدة الأرشيف: لا بطاقتان فعّالتان لنفس المشترك
  if (card.subscriberId) {
    const active = await prisma.taskCard.findFirst({
      where: { subscriberId: card.subscriberId, settled: false, isDeleted: false, id: { not: card.id } },
      select: { id: true, kind: true },
    });
    if (active) {
      return NextResponse.json({ error: `لهذا المشترك بطاقة فعّالة أخرى («${active.kind}» #${active.id}) — أكمِلها قبل الاسترجاع` }, { status: 409 });
    }
  }

  const position = await prisma.taskCard.count({ where: { listId: card.listId, isDeleted: false, archivedAt: null } });
  await prisma.taskCard.update({ where: { id: card.id }, data: { isDeleted: false, position } });

  const byName = session.fullName ?? session.username;
  await appendCardHistory(card.id, byName, "♻️ استُرجعت البطاقة من المحذوفات إلى عمودها");
  await prisma.auditLog.create({
    data: {
      userId: session.userId,
      action: "RESTORE_CARD", entity: "taskCard", entityId: String(card.id),
      details:
        `استرجاع بطاقة «${card.title}» (${card.kind}) إلى عمود «${list.name}»` +
        (card.done && !card.settled ? ` — يعود ${((card.amount ?? 0) + (card.subAmount ?? 0)).toLocaleString("en-US")} د.ع إلى تحصيل ${card.assignee ?? "الفني"}` : "") +
        " — صور البطاقة لا تعود (مُحيت عند الحذف)",
    },
  }).catch(() => { /* لا يُفشل الاسترجاع بسبب القيد */ });

  return NextResponse.json({ ok: true, listName: list.name });
}
