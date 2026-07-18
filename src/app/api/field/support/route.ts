import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resolveFieldOffice, canOperateOfficeIn, getOrCreateBoard, endSupport } from "@/lib/field";
import { agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// دعم مؤقت: استعارة فني من مكتب آخر ليعمل في هذا المكتب (بطاقات محدّدة أو يوم كامل).
export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const reqOffice = new URL(request.url).searchParams.get("officeId");
  const officeId = resolveFieldOffice(s, reqOffice ? Number(reqOffice) : null);
  if (officeId == null) return NextResponse.json({ borrowed: [], candidates: [], cards: [] });
  const agentTowers = await agentTowerIds(s);
  if (!agentTowers.includes(officeId)) return NextResponse.json({ borrowed: [], candidates: [], cards: [] });

  const towers = await prisma.tower.findMany({ where: { isDeleted: false, id: { in: agentTowers } }, select: { id: true, name: true } });
  const tn = new Map(towers.map((t) => [t.id, t.name]));

  const borrowed = await prisma.technician.findMany({
    where: { isDeleted: false, supportTowerId: officeId, NOT: { towerId: officeId } },
    orderBy: { id: "asc" },
  });
  const candidates = await prisma.technician.findMany({
    where: { isDeleted: false, towerId: { in: agentTowers }, NOT: { towerId: officeId }, supportTowerId: null },
    orderBy: { id: "asc" },
  });

  // بطاقات المكتب غير المنجزة (لاختيارها في دعم البطاقات المحدّدة)
  const board = await getOrCreateBoard(officeId);
  const lists = await prisma.taskList.findMany({ where: { boardId: board.id, isDeleted: false }, select: { id: true } });
  const cards = await prisma.taskCard.findMany({
    where: { listId: { in: lists.map((l) => l.id) }, isDeleted: false, done: false },
    select: { id: true, title: true, kind: true, assignee: true }, orderBy: { id: "desc" }, take: 100,
  });

  const shape = (t: { id: number; name: string; towerId: number | null; supportKind?: string | null }) => ({
    id: t.id, name: t.name, homeOffice: tn.get(t.towerId ?? -1) ?? "—", towerId: t.towerId, supportKind: t.supportKind ?? null,
  });
  return NextResponse.json({ officeId, borrowed: borrowed.map(shape), candidates: candidates.map(shape), cards });
}

// استعارة فني (POST): { technicianId, officeId, kind: "cards"|"day", cardIds?: number[] }
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  const technicianId = Number(b?.technicianId);
  const officeId = resolveFieldOffice(s, b?.officeId != null ? Number(b.officeId) : null);
  if (!technicianId || officeId == null) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  // الموظف يطلب الدعم لمكتبه فقط؛ المدير لأي مكتب من وكيله (لا مكاتب وكلاء آخرين)
  const agentTowers = await agentTowerIds(s);
  if (!canOperateOfficeIn(s, officeId, agentTowers)) return NextResponse.json({ error: "لا يمكنك طلب دعم لمكتب آخر" }, { status: 403 });

  const tech = await prisma.technician.findFirst({ where: { id: technicianId, isDeleted: false } });
  if (!tech) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  if (tech.towerId === officeId) return NextResponse.json({ error: "الفني من نفس المكتب" }, { status: 400 });
  if (tech.towerId != null && !agentTowers.includes(tech.towerId)) return NextResponse.json({ error: "الفني لا يتبع حسابك" }, { status: 403 });

  const kind = b?.kind === "cards" ? "cards" : "day";
  let cardIds: number[] = [];
  if (kind === "cards") {
    cardIds = (Array.isArray(b?.cardIds) ? b.cardIds : []).map(Number).filter(Boolean);
    if (cardIds.length === 0) return NextResponse.json({ error: "اختر بطاقة واحدة على الأقل للدعم" }, { status: 400 });
    // تحقّق أن البطاقات تتبع لوحة المكتب الطالب
    const board = await getOrCreateBoard(officeId);
    const lists = await prisma.taskList.findMany({ where: { boardId: board.id, isDeleted: false }, select: { id: true } });
    const listIds = new Set(lists.map((l) => l.id));
    const cards = await prisma.taskCard.findMany({ where: { id: { in: cardIds }, isDeleted: false }, select: { id: true, listId: true } });
    if (cards.length !== cardIds.length || !cards.every((c) => listIds.has(c.listId))) {
      return NextResponse.json({ error: "بعض البطاقات لا تتبع هذا المكتب" }, { status: 400 });
    }
  }

  await prisma.technician.update({
    where: { id: technicianId },
    data: { supportTowerId: officeId, supportKind: kind, supportCardIds: kind === "cards" ? JSON.stringify(cardIds) : null },
  });
  // توجيه بطاقات الدعم للفني المُعار
  if (kind === "cards") {
    await prisma.taskCard.updateMany({ where: { id: { in: cardIds } }, data: { technicianId, assignee: tech.name } });
  }
  return NextResponse.json({ ok: true });
}

// إنهاء الدعم (DELETE): يعيد الفني لمكتبه الأصلي
export async function DELETE(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const technicianId = Number(new URL(request.url).searchParams.get("technicianId"));
  if (!technicianId) return NextResponse.json({ error: "technicianId مطلوب" }, { status: 400 });
  const tech = await prisma.technician.findUnique({ where: { id: technicianId }, select: { towerId: true, supportTowerId: true } });
  if (!tech) return NextResponse.json({ error: "الفني غير موجود" }, { status: 404 });
  // عزل الوكيل: لا إنهاء دعم فنيٍّ لا يتبع مكاتب وكيل المستخدم
  const agentTowers = await agentTowerIds(s);
  if (tech.towerId != null && !agentTowers.includes(tech.towerId)) {
    return NextResponse.json({ error: "الفني لا يتبع حسابك" }, { status: 403 });
  }
  if (tech.supportTowerId != null && !canOperateOfficeIn(s, tech.supportTowerId, agentTowers)) {
    return NextResponse.json({ error: "لا يمكنك إنهاء دعم مكتب آخر" }, { status: 403 });
  }
  await endSupport(technicianId);
  return NextResponse.json({ ok: true });
}
