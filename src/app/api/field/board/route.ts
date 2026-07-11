import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// يُرجِع لوحة "إدارة الفنيين" مع أعمدتها وبطاقاتها (يُنشئها بأعمدة افتراضية إن لم توجد).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  let board = await prisma.taskBoard.findFirst({ where: { isDeleted: false }, orderBy: { id: "asc" } });
  if (!board) {
    board = await prisma.taskBoard.create({ data: { name: "إدارة الفنيين" } });
    const defaults = ["طلبات جديدة", "قيد التنفيذ", "منجزة"];
    for (let i = 0; i < defaults.length; i++) {
      await prisma.taskList.create({ data: { boardId: board.id, name: defaults[i], position: i } });
    }
  }

  const lists = await prisma.taskList.findMany({
    where: { boardId: board.id, isDeleted: false },
    orderBy: { position: "asc" },
  });
  const cards = await prisma.taskCard.findMany({
    where: { listId: { in: lists.map((l) => l.id) }, isDeleted: false },
    orderBy: { position: "asc" },
  });

  return NextResponse.json({ board, lists, cards });
}
