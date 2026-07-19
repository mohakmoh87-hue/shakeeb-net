import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";
import { getSession, getTechSession } from "@/lib/auth";
import { agentTowerIds } from "@/lib/guard";
import { can } from "@/lib/rbac";

// فاعل عمليات البطاقة: مستخدم (مدير/موظف مكتب) أو فني — لتوحيد التحقّق والإسناد.
export type FieldActor = {
  isTech: boolean;
  userId: number | null;   // إسناد الحركات المالية/التدقيق (null للفني)
  agentId: number | null;
  name: string;            // للعرض والتدقيق
  technicianId: number | null; // معرّف الفني (للفني فقط)
  session: SessionPayload | null; // مسار المستخدم فقط
};

// يحلّ الفاعل ويتحقّق من حقّه في العمل على بطاقة (بدء/إنجاز/تأجيل).
// المستخدم: كتابة على مكتب ضمن وكيله (canOperateCard). الفني: بطاقته المسندة إليه
// حصراً وضمن مكاتب وكيله (عزل صارم) — لا يمسّ بطاقات غيره ولا وكيلاً آخر.
export async function resolveCardActor(cardId: number): Promise<
  | { ok: true; actor: FieldActor }
  | { ok: false; status: number; error: string }
> {
  const user = await getSession();
  if (user) {
    if (!(await canOperateCard(user, cardId))) {
      return { ok: false, status: 403, error: "مشاهدة فقط — لا يمكنك التعديل على مكتب آخر" };
    }
    return { ok: true, actor: { isTech: false, userId: user.userId, agentId: user.agentId, name: user.fullName ?? user.username, technicianId: null, session: user } };
  }
  const tech = await getTechSession();
  if (!tech) return { ok: false, status: 401, error: "غير مصرّح" };
  const card = await prisma.taskCard.findFirst({ where: { id: cardId, isDeleted: false }, select: { technicianId: true } });
  if (!card) return { ok: false, status: 404, error: "البطاقة غير موجودة" };
  if (card.technicianId !== tech.technicianId) return { ok: false, status: 403, error: "هذه البطاقة ليست مسندة إليك" };
  // عزل الوكيل: مكتب البطاقة يجب أن يتبع وكيل الفني (يشمل مكتبه ومكتب الدعم ضمن نفس الوكيل)
  const officeId = await cardOfficeId(cardId);
  const office = officeId != null ? await prisma.tower.findUnique({ where: { id: officeId }, select: { agentId: true } }) : null;
  if (!office || office.agentId == null || office.agentId !== tech.agentId) {
    return { ok: false, status: 403, error: "البطاقة ليست ضمن مكاتبك" };
  }
  return { ok: true, actor: { isTech: true, userId: null, agentId: tech.agentId, name: tech.name, technicianId: tech.technicianId, session: null } };
}

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
// هل يجوز للمستخدم الكتابة على مكتبٍ ما؟ ضمن وكيله حصراً (عزل المستأجر):
// المدير (field.manage) لكل مكاتب وكيله فقط؛ الموظف لمكتبه فقط (مشاهدة لغيره).
// النسخة المتزامنة لمن جلب مكاتب الوكيل مسبقاً (agentTowerIds مرّة واحدة).
export function canOperateOfficeIn(session: SessionPayload, towerId: number | null, agentTowers: number[]): boolean {
  if (towerId == null) return false;
  if (!can(session, "field.manage")) return towerId === (session.towerId ?? null);
  return agentTowers.includes(towerId);
}
export async function canOperateOffice(session: SessionPayload, towerId: number | null): Promise<boolean> {
  if (towerId == null) return false;
  // الموظف لا يحتاج جلب مكاتب الوكيل — مكتبه فقط
  if (!can(session, "field.manage")) return towerId === (session.towerId ?? null);
  return (await agentTowerIds(session)).includes(towerId);
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

// إنهاء دعم فني: يعيده لمكتبه الأصلي (يمسح حقول الدعم كلّها).
export async function endSupport(technicianId: number) {
  await prisma.technician.update({ where: { id: technicianId }, data: { supportTowerId: null, supportKind: null, supportCardIds: null } });
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
