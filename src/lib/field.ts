import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { can } from "@/lib/rbac";

// عزل المستأجر للوحات الفنيين: هل مكتب اللوحة يتبع أحد مكاتب وكيل المستخدم؟
// (يسمح بالتعاون بين مكاتب نفس الوكيل، ويمنع الوصول لبيانات وكيل آخر)
async function agentOwnsTower(session: SessionPayload, towerId: number | null | undefined): Promise<boolean> {
  if (towerId == null) return false;
  const towers = await agentTowerIds(session);
  return towers.includes(towerId);
}
export async function agentOwnsBoard(session: SessionPayload, boardId: number): Promise<boolean> {
  const board = await prisma.taskBoard.findUnique({ where: { id: boardId }, select: { towerId: true } });
  return agentOwnsTower(session, board?.towerId);
}
export async function agentOwnsList(session: SessionPayload, listId: number): Promise<boolean> {
  const list = await prisma.taskList.findUnique({ where: { id: listId }, select: { boardId: true } });
  return list ? agentOwnsBoard(session, list.boardId) : false;
}
export async function agentOwnsCard(session: SessionPayload, cardId: number): Promise<boolean> {
  const card = await prisma.taskCard.findUnique({ where: { id: cardId }, select: { listId: true } });
  return card ? agentOwnsList(session, card.listId) : false;
}

// مكتب العمود/البطاقة (لتقييد الكتابة على مستوى المكتب داخل الوكيل)
export async function listOfficeId(listId: number): Promise<number | null> {
  const list = await prisma.taskList.findUnique({ where: { id: listId }, select: { boardId: true } });
  if (!list) return null;
  const board = await prisma.taskBoard.findUnique({ where: { id: list.boardId }, select: { towerId: true } });
  return board?.towerId ?? null;
}
export async function cardOfficeId(cardId: number): Promise<number | null> {
  const card = await prisma.taskCard.findUnique({ where: { id: cardId }, select: { listId: true } });
  return card ? listOfficeId(card.listId) : null;
}
// هل يجوز للمستخدم الكتابة على مكتبٍ ما؟ المدير (field.manage) لأي مكتب؛ الموظف لمكتبه فقط (مشاهدة لغيره).
export function canOperateOffice(session: SessionPayload, towerId: number | null): boolean {
  if (can(session, "field.manage")) return true;
  return towerId != null && towerId === (session.towerId ?? null);
}
export async function canOperateCard(session: SessionPayload, cardId: number): Promise<boolean> {
  return canOperateOffice(session, await cardOfficeId(cardId));
}
export async function canOperateList(session: SessionPayload, listId: number): Promise<boolean> {
  return canOperateOffice(session, await listOfficeId(listId));
}

// لوحة إدارة الفنيين مستقلّة لكل مكتب (TaskBoard.towerId)، والمدير يرى كل المكاتب.

// هل الجلسة لمدير يرى كل المكاتب؟ (أدمن أو مستخدم بلا مكتب محدّد)
export function isFieldManager(session: SessionPayload): boolean {
  return !!session.isAdmin || session.towerId == null;
}

// المكتب الفعّال: أي مستخدم يستطيع عرض/مساعدة أي مكتب (تعاون بين المكاتب وقت الضغط).
// عند عدم تحديد مكتب: المدير يبدأ بلا مكتب (أول مكتب)، ومستخدم المكتب يبدأ بمكتبه.
export function resolveFieldOffice(session: SessionPayload, requested: number | null): number | null {
  if (requested != null) return requested;
  return isFieldManager(session) ? null : session.towerId ?? null;
}

// حساب "نثرية" للمكتب (مقبوضات متفرقة) — يُنشأ إن لم يوجد.
export async function getOrCreatePettyAccount(towerId: number | null) {
  let acc = await prisma.account.findFirst({
    where: { name: "نثرية", towerId: towerId ?? null, isDeleted: false },
  });
  if (!acc) {
    acc = await prisma.account.create({ data: { name: "نثرية", typeName: "مقبوضات", towerId: towerId ?? null } });
  }
  return acc;
}

// لوحة المكتب (تُنشأ إن لم توجد) — لوحة واحدة لكل قيمة towerId.
export async function getOrCreateBoard(towerId: number | null) {
  let board = await prisma.taskBoard.findFirst({
    where: { towerId: towerId ?? null, isDeleted: false },
    orderBy: { id: "asc" },
  });
  if (!board) {
    board = await prisma.taskBoard.create({ data: { name: "إدارة الفنيين", towerId: towerId ?? null } });
  }
  return board;
}
