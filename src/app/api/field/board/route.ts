import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { agentOfficeFilter } from "@/lib/guard";
import { isFieldManager, resolveFieldOffice, getOrCreateBoard } from "@/lib/field";

export const dynamic = "force-dynamic";

// لوحة "إدارة الفنيين" لمكتب واحد مع أعمدتها وبطاقاتها وفنّييه.
// مستخدم المكتب يرى لوحة مكتبه فقط؛ المدير يختار المكتب عبر ?officeId ويرى الكل.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const manager = isFieldManager(session);
  // عزل المستأجر: مكاتب وكيل المستخدم فقط (أي فني قد يساعد مكتباً آخر ضمن نفس الوكيل)
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false, ...(await agentOfficeFilter(session)) },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  const officeIds = new Set(offices.map((o) => o.id));

  const reqOffice = new URL(request.url).searchParams.get("officeId");
  let officeId = resolveFieldOffice(session, reqOffice ? Number(reqOffice) : null);
  // لا يُسمح بمكتب خارج وكيل المستخدم
  if (officeId != null && !officeIds.has(officeId)) officeId = null;
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
  // فنّيو المكتب + الفنيون المُعارون له مؤقتاً (دعم)
  const techRows = await prisma.technician.findMany({
    where: officeId == null
      ? { towerId: null, isDeleted: false }
      : { isDeleted: false, OR: [{ towerId: officeId }, { supportTowerId: officeId }] },
    orderBy: { id: "asc" },
  });
  const technicians = techRows.map((t) => ({
    id: t.id, name: t.name, phone: t.phone,
    isSupport: officeId != null && t.towerId !== officeId && t.supportTowerId === officeId,
  }));
  const cardTypes = await prisma.cardType.findMany({
    where: { isDeleted: false }, orderBy: [{ position: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    board, lists, cards, technicians, cardTypes, offices, officeId,
    isManager: manager,
    canManage: can(session, "field.manage"),
  });
}
