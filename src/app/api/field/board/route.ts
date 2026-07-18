import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { agentTowerIds } from "@/lib/guard";
import { isFieldManager, resolveFieldOffice, getOrCreateBoard, canOperateOffice } from "@/lib/field";

export const dynamic = "force-dynamic";

// لوحة لمكتب واحد: الأعمدة والبطاقات (معزولة بالوكيل). مشترك بين المستخدم والفني.
async function buildBoard(officeId: number | null, agentId: number | null) {
  const board = await getOrCreateBoard(officeId);
  const lists = await prisma.taskList.findMany({ where: { boardId: board.id, isDeleted: false }, orderBy: { position: "asc" } });
  const cards = await prisma.taskCard.findMany({ where: { listId: { in: lists.map((l) => l.id) }, isDeleted: false }, orderBy: { position: "asc" } });
  const techRows = await prisma.technician.findMany({
    where: officeId == null ? { towerId: null, isDeleted: false } : { isDeleted: false, OR: [{ towerId: officeId }, { supportTowerId: officeId }] },
    orderBy: { id: "asc" },
  });
  const technicians = techRows.map((t) => ({ id: t.id, name: t.name, phone: t.phone, isSupport: officeId != null && t.towerId !== officeId && t.supportTowerId === officeId }));
  // عزل المستأجر: فئات البطاقات لوكيل المستخدم فقط
  const cardTypes = await prisma.cardType.findMany({ where: { isDeleted: false, agentId: agentId ?? -1 }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  return { board, lists, cards, technicians, cardTypes };
}

// لوحة "إدارة الفنيين" لمكتب واحد مع أعمدتها وبطاقاتها وفنّييه.
// مستخدم المكتب يرى لوحة مكتبه فقط؛ المدير يختار المكتب عبر ?officeId ويرى الكل؛ والفني يرى لوحة مكتبه.
export async function GET(request: Request) {
  // الفني: لوحة مكتبه فقط، بلا إدارة
  const tech = await getTechSession();
  if (tech) {
    const data = await buildBoard(tech.towerId, tech.agentId);
    return NextResponse.json({ ...data, offices: [], officeId: tech.towerId, isManager: false, canManage: false, canOperate: true, myOfficeId: tech.towerId, role: "technician" });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const manager = isFieldManager(session);
  // عزل المستأجر: كل مكاتب وكيل المستخدم — أي مستخدم يتصفّح المكاتب (مشاهدة)، والكتابة مقيّدة بمكتبه.
  const agentTowers = await agentTowerIds(session);
  const offices = await prisma.tower.findMany({
    where: { isDeleted: false, id: { in: agentTowers.length ? agentTowers : [-1] } },
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

  const data = await buildBoard(officeId, session.agentId);
  return NextResponse.json({
    ...data, offices, officeId,
    isManager: manager,
    canManage: can(session, "field.manage"),
    // الكتابة على المكتب المعروض: المدير لأي مكتب، والموظف لمكتبه فقط
    canOperate: canOperateOffice(session, officeId),
    myOfficeId: session.towerId ?? null,
    role: manager ? "manager" : "office",
  });
}
