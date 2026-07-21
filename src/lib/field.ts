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

// يحلّ الفاعل ويتحقّق من حقّه في إضافة بطاقة إلى عمود (list).
// المستخدم: كتابة على مكتب ضمن وكيله. الفني: عمود ضمن مكتبه هو حصراً (بطاقته تُسنَد إليه).
export async function resolveListActor(listId: number): Promise<
  | { ok: true; actor: FieldActor }
  | { ok: false; status: number; error: string }
> {
  const user = await getSession();
  if (user) {
    if (!(await agentOwnsList(user, listId))) return { ok: false, status: 403, error: "العمود لا يتبع حسابك" };
    if (!(await canOperateList(user, listId))) return { ok: false, status: 403, error: "مشاهدة فقط — لا يمكنك التعديل على مكتب آخر" };
    return { ok: true, actor: { isTech: false, userId: user.userId, agentId: user.agentId, name: user.fullName ?? user.username, technicianId: null, session: user } };
  }
  const tech = await getTechSession();
  if (!tech) return { ok: false, status: 401, error: "غير مصرّح" };
  const officeId = await listOfficeId(listId);
  // مكاتب الفني الفعّالة: الأصلي + الإضافية الدائمة + مكتب الدعم المؤقت
  const effective = await techEffectiveOfficesById(tech.technicianId);
  if (officeId == null || !effective.includes(officeId)) {
    return { ok: false, status: 403, error: "العمود ليس في مكاتبك" };
  }
  return { ok: true, actor: { isTech: true, userId: null, agentId: tech.agentId, name: tech.name, technicianId: tech.technicianId, session: null } };
}

// ===== مكاتب الفني الفعّالة =====
// المكاتب الإضافية الدائمة (JSON على صف الفني — يضبطها المدير فقط)
export function parseExtraTowers(s: string | null | undefined): number[] {
  try {
    const a = JSON.parse(s ?? "[]");
    return Array.isArray(a) ? a.map(Number).filter((x) => Number.isFinite(x) && x > 0) : [];
  } catch { return []; }
}
// مكاتب الفني الفعّالة = الأصلي + الإضافية الدائمة + مكتب الدعم المؤقت (أثناءه فقط).
// تُستخدم موحّدةً في كل الفحوصات (لوحات/بطاقات/ذمم/تحويل) — فلا تعارض بين النظامين.
export function techEffectiveOffices(t: { towerId: number | null; supportTowerId?: number | null; extraTowerIds?: string | null }): number[] {
  const set = new Set<number>();
  if (t.towerId != null) set.add(t.towerId);
  for (const id of parseExtraTowers(t.extraTowerIds)) set.add(id);
  if (t.supportTowerId != null) set.add(t.supportTowerId);
  return [...set];
}
export async function techEffectiveOfficesById(technicianId: number): Promise<number[]> {
  const t = await prisma.technician.findUnique({
    where: { id: technicianId },
    select: { towerId: true, supportTowerId: true, extraTowerIds: true },
  });
  return t ? techEffectiveOffices(t) : [];
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

// حذف نهائي لبطاقات الأرشيف الأقدم من أسبوع (+ صورها) — يُستدعى من الكرون السحابي وتنظيف العامل.
// يشمل أيضاً بطاقات النمط القديم (محصَّلة ومحذوفة ناعماً) لتحرير المساحة.
export async function purgeOldArchivedCards(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const old = await prisma.taskCard.findMany({
    where: { OR: [{ archivedAt: { lt: cutoff } }, { settled: true, isDeleted: true }] },
    select: { id: true }, take: 1000,
  });
  if (old.length === 0) return 0;
  const ids = old.map((c) => c.id);
  await prisma.$transaction([
    prisma.cardPhoto.deleteMany({ where: { cardId: { in: ids } } }),
    prisma.taskCard.deleteMany({ where: { id: { in: ids } } }),
  ]);
  return ids.length;
}

// سجلّ تغييرات البطاقة (داخل البطاقة نفسها): يُلحق حدثاً JSON {at,by,text} — تأجيل/تحويل/نقل/إنجاز…
// لا يُفشل العملية الأصلية إن تعثّر، ويُقصّ لآخر 100 حدث.
export async function appendCardHistory(cardId: number, by: string, text: string): Promise<void> {
  try {
    const card = await prisma.taskCard.findUnique({ where: { id: cardId }, select: { history: true } });
    let arr: { at: string; by: string; text: string }[] = [];
    try { arr = card?.history ? JSON.parse(card.history) : []; } catch { arr = []; }
    arr.push({ at: new Date().toISOString(), by, text });
    if (arr.length > 100) arr = arr.slice(-100);
    await prisma.taskCard.update({ where: { id: cardId }, data: { history: JSON.stringify(arr) } });
  } catch { /* لا يُفشل العملية الأصلية */ }
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
// الذمم المتبقية من مواد مكتب الدعم تُرحَّل تلقائياً معه: كمية مكتب الدعم تنقص
// (المادة غادرت مع الفني)، وتُضاف لمادة بنفس الاسم بمخزن مكتبه الأصلي (تُنشأ إن
// غابت — يُعتمد اسم المادة للمطابقة)، وتبقى بذمّته لكن على مادة مكتبه.
export async function endSupport(technicianId: number) {
  const tech = await prisma.technician.findUnique({
    where: { id: technicianId },
    select: { name: true, towerId: true, supportTowerId: true, extraTowerIds: true },
  });
  const supportOffice = tech?.supportTowerId ?? null;
  const homeOffice = tech?.towerId ?? null;
  // مكتب الدعم ضمن مكاتبه الإضافية الدائمة؟ لا ترحيل — فهو باقٍ يعمل فيه كأصلي
  const stillHis = supportOffice != null && parseExtraTowers(tech?.extraTowerIds).includes(supportOffice);
  if (supportOffice != null && homeOffice != null && supportOffice !== homeOffice && !stillHis) {
    try {
      const rows = await prisma.custody.findMany({ where: { technicianId, isDeleted: false, qty: { gt: 0 } } });
      for (const c of rows) {
        const item = await prisma.item.findFirst({ where: { id: c.itemId, isDeleted: false } });
        if (!item || item.towerId !== supportOffice) continue; // ذمم مواد مكتب الدعم فقط
        await prisma.$transaction(async (tx) => {
          await tx.item.update({ where: { id: item.id }, data: { count: { decrement: c.qty } } });
          let home = await tx.item.findFirst({ where: { name: item.name, towerId: homeOffice, isDeleted: false } });
          if (home) {
            await tx.item.update({ where: { id: home.id }, data: { count: { increment: c.qty } } });
          } else {
            home = await tx.item.create({
              data: {
                name: item.name, category: item.category, priceDinar: item.priceDinar,
                priceSale: item.priceSale, priceSale2: item.priceSale2, barcode: item.barcode,
                count: c.qty, towerId: homeOffice,
              },
            });
          }
          // إعادة ربط الذمة بمادة مكتبه (دمجاً مع ذمة قائمة لنفس المادة إن وُجدت)
          const homeCustody = await tx.custody.findFirst({ where: { technicianId, itemId: home.id, isDeleted: false } });
          if (homeCustody) {
            await tx.custody.update({ where: { id: homeCustody.id }, data: { qty: homeCustody.qty + c.qty } });
            await tx.custody.update({ where: { id: c.id }, data: { qty: 0, isDeleted: true } });
          } else {
            await tx.custody.update({ where: { id: c.id }, data: { itemId: home.id, towerId: homeOffice } });
          }
          await tx.auditLog.create({
            data: {
              action: "SUPPORT_CUSTODY_TRANSFER", entity: "custody", entityId: String(c.id),
              details: `انتهاء دعم ${tech?.name ?? technicianId}: ترحيل «${item.name}»×${c.qty} من مكتب الدعم (${supportOffice}) إلى مخزن مكتبه (${homeOffice}) — بقيت بذمّته`,
            },
          }).catch(() => {});
        });
      }
    } catch { /* أفضل جهد — لا يُعطَّل إنهاء الدعم بترحيل الذمم */ }
  }
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
