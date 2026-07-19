import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getTechSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { agentTowerIds } from "@/lib/guard";
import { isFieldManager, resolveFieldOffice, getOrCreateBoard, canOperateOfficeIn } from "@/lib/field";

export const dynamic = "force-dynamic";

// لوحة لمكتب واحد: الأعمدة والبطاقات (معزولة بالوكيل). مشترك بين المستخدم والفني.
async function buildBoard(officeId: number | null, agentId: number | null) {
  const board = await getOrCreateBoard(officeId);
  const lists = await prisma.taskList.findMany({ where: { boardId: board.id, isDeleted: false }, orderBy: { position: "asc" } });
  // المؤرشفة (بعد التحصيل) لا تظهر على اللوحة — تُعرض من نافذة الأرشيف
  const cards = await prisma.taskCard.findMany({ where: { listId: { in: lists.map((l) => l.id) }, isDeleted: false, archivedAt: null }, orderBy: { position: "asc" } });
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
  // الفني: لوحة مكتبه الأصلي، بلا إدارة — ولا يُحرم منها أثناء الدعم المؤقت
  const tech = await getTechSession();
  if (tech) {
    const data = await buildBoard(tech.towerId, tech.agentId);
    // مُعارٌ لدعم مؤقت؟ تُضاف له (وله وحده) بطاقاته في مكتب الدعم بعمودٍ افتراضي «دعم مؤقت»
    const me = await prisma.technician.findUnique({ where: { id: tech.technicianId }, select: { supportTowerId: true } });
    if (me?.supportTowerId != null && me.supportTowerId !== tech.towerId) {
      const sBoard = await getOrCreateBoard(me.supportTowerId);
      const sLists = await prisma.taskList.findMany({ where: { boardId: sBoard.id, isDeleted: false }, select: { id: true } });
      const sCards = await prisma.taskCard.findMany({
        where: { listId: { in: sLists.map((l) => l.id) }, technicianId: tech.technicianId, isDeleted: false, archivedAt: null },
        orderBy: { position: "asc" },
      });
      if (sCards.length > 0) {
        const sOffice = await prisma.tower.findUnique({ where: { id: me.supportTowerId }, select: { name: true } });
        const template = await prisma.taskList.findUnique({ where: { id: sCards[0].listId } });
        if (template) {
          const SUPPORT_LIST_ID = -1; // عمود افتراضي (عرضٌ فقط — البطاقات تبقى فعلياً بلوحة مكتب الدعم)
          data.lists.push({ ...template, id: SUPPORT_LIST_ID, name: `🤝 دعم مؤقت — ${sOffice?.name ?? "مكتب آخر"}`, position: 9999 });
          for (const c of sCards) data.cards.push({ ...c, listId: SUPPORT_LIST_ID });
        }
      }
    }
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
    // الكتابة على المكتب المعروض: المدير لمكاتب وكيله، والموظف لمكتبه فقط
    canOperate: canOperateOfficeIn(session, officeId, agentTowers),
    myOfficeId: session.towerId ?? null,
    role: manager ? "manager" : "office",
  });
}
