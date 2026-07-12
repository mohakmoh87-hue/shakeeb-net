import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { isFieldManager, resolveFieldOffice, getOrCreateBoard } from "@/lib/field";

export const dynamic = "force-dynamic";

// لوحة "إدارة الفنيين" لمكتب واحد مع أعمدتها وبطاقاتها وفنّييه.
// مستخدم المكتب يرى لوحة مكتبه فقط؛ المدير يختار المكتب عبر ?officeId ويرى الكل.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const manager = isFieldManager(session);
  // قائمة كل المكاتب متاحة للجميع (ليتمكّن أي فني من مساعدة مكتب آخر وقت الضغط)
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  const reqOffice = new URL(request.url).searchParams.get("officeId");
  let officeId = resolveFieldOffice(session, reqOffice ? Number(reqOffice) : null);
  // المدير بلا اختيار → افتراضياً أول مكتب
  if (manager && officeId == null && offices.length > 0) officeId = offices[0].id;

  const board = await getOrCreateBoard(officeId);
  const lists = await prisma.taskList.findMany({
    where: { boardId: board.id, isDeleted: false },
    orderBy: { position: "asc" },
  });
  const cards = await prisma.taskCard.findMany({
    where: { listId: { in: lists.map((l) => l.id) }, isDeleted: false },
    orderBy: { position: "asc" },
  });
  const technicians = await prisma.technician.findMany({
    where: { towerId: officeId ?? null, isDeleted: false },
    orderBy: { id: "asc" },
  });
  const cardTypes = await prisma.cardType.findMany({
    where: { isDeleted: false }, orderBy: [{ position: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    board, lists, cards, technicians, cardTypes, offices, officeId,
    isManager: manager,
    canManage: can(session, "field.manage"),
  });
}
