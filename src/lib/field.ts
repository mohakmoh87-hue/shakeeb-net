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
  // مكاتب الفني الفعّالة: الأصلي + الإضافية الدائمة + مكتب الدعم المؤقت — موسَّعةً بمجموعة
  // اللوحة كي يضيف الفنيُّ على اللوحة المشتركة (لا يمسّ ذلك مخزنَه/بصمتَه — عزلُهما بـtowerId).
  const effective = await techEffectiveOfficesById(tech.technicianId);
  const boardOffices = new Set<number>();
  for (const off of effective) for (const g of await fieldGroupOffices(off)) boardOffices.add(g);
  if (officeId == null || !boardOffices.has(officeId)) {
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
  if (!can(session, "field.manage")) {
    if (towerId === (session.towerId ?? null)) return true;
    // مجموعةُ اللوحة: موظفُ مكتبٍ ثانويٍّ يعمل على اللوحة المشتركة (مكتبُها الرئيسيّ) —
    // ضمن نفس الوكيل حصراً. للمكتب غير المُجمَّع تعود المجموعةُ [نفسه] فلا يتغيّر شيء.
    if (session.towerId == null) return false;
    return (await fieldGroupOffices(session.towerId)).includes(towerId);
  }
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

// ===== دعم البطاقات: متى ينتهي؟ (قرار محمد 2026-08-09) =====
// **الإنجاز لا يُنهي الدعم ولا يُرحّل الذمّة — «اكمال» هو الذي يُنهي ويُرحّل.** فما دامت بطاقةُ دعمٍ
// منجزةً بلا تحصيل يبقى الفنيّ على دعمه (ولا يُنجز بطاقات مكتبه). ويُسقَط من الحساب ما حُذف من
// البطاقات أو حُوِّل لفنيٍّ آخر — فإن لم يبقَ له شيءٌ انتهى دعمه.
// تُنادى من: التحصيل · الإنجاز (للإشعار فقط) · حذف بطاقة · تحويل بطاقة لفنيٍّ آخر.
export async function maybeEndCardSupport(technicianId: number): Promise<{ ended: boolean; allDone: boolean }> {
  const t = await prisma.technician.findUnique({
    where: { id: technicianId },
    select: { id: true, name: true, agentId: true, towerId: true, supportKind: true, supportCardIds: true, supportTowerId: true },
  });
  if (!t || t.supportTowerId == null || t.supportKind !== "cards" || !t.supportCardIds) return { ended: false, allDone: false };
  let ids: number[] = [];
  try { ids = JSON.parse(t.supportCardIds) as number[]; } catch { return { ended: false, allDone: false }; }
  if (!Array.isArray(ids) || ids.length === 0) { await endSupport(technicianId); return { ended: true, allDone: true }; }
  // ما زال يخصّه فعلاً: غير محذوف ومُسنَدٌ إليه (التحويل لفنيٍّ آخر يُخرج البطاقة من دعمه)
  const cards = await prisma.taskCard.findMany({
    where: { id: { in: ids }, isDeleted: false, technicianId },
    select: { id: true, done: true, settled: true },
  });
  if (cards.length === 0) { await endSupport(technicianId); return { ended: true, allDone: true }; }
  // «انتهت» = settled — وهي تشمل **الملغاة** (الإلغاء يكتب settled=true بلا done). كان الشرط
  // `done && settled` يعني أنّ بطاقةً ملغاةً **تُقفل الدعم إلى الأبد**: لا تُنجَز فلا تُحصَّل، فيبقى
  // الفنيّ ممنوعاً من مكتبه ولا تُرحَّل ذمّته (اصطاده تدقيقٌ عدائيّ 2026-08-09).
  const unfinished = cards.filter((c) => !c.settled);
  if (unfinished.length === 0) { await endSupport(technicianId); return { ended: true, allDone: true }; }
  return { ended: false, allDone: unfinished.every((c) => c.done) };
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
  // فشلُ الترحيل لا يُبتلَع بعد اليوم (اصطاده تدقيقٌ عدائيّ): كان الخطأ يُكتَم ثمّ تُصفَّر حقول
  // الدعم على أيّ حال ⇒ موادّ مكتب الدعم تبقى بذمّته بلا ترحيلٍ ولا أثر، ولا محاولةَ ثانية.
  // الآن: إن فشل شيءٌ **يبقى الدعم قائماً** فتُعاد المحاولة (بصمة الخروج/٠٠:١٥/اكمال).
  let transferFailed = false;
  if (supportOffice != null && homeOffice != null && supportOffice !== homeOffice && !stillHis) {
    try {
      const rows = await prisma.custody.findMany({ where: { technicianId, isDeleted: false, qty: { gt: 0 } } });
      for (const c of rows) {
        const item = await prisma.item.findFirst({ where: { id: c.itemId, isDeleted: false } });
        if (!item || item.towerId !== supportOffice) continue; // ذمم مواد مكتب الدعم فقط
        // كلّ مادّةٍ في معاملةٍ مستقلّة: فشلُ واحدةٍ لا يُسقط ما نجح، ويُعلَّم ليُعاد لاحقاً
        try {
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
          // توثيق بإدراج خام بلا RETURNING — إنهاء الدعم يعمل أيضاً من العامل المحلي
          // (الخروج التلقائي) بدور الوكيل الذي له على audit_logs «إدراج فقط» بلا قراءة،
          // وcreate يضيف RETURNING فيفشل ويُسقط معاملة ترحيل الذمّة كلها.
          await tx.$executeRaw`INSERT INTO audit_logs (action, entity, "entityId", details)
            VALUES ('SUPPORT_CUSTODY_TRANSFER', 'custody', ${String(c.id)}, ${`انتهاء دعم ${tech?.name ?? technicianId}: ترحيل «${item.name}»×${c.qty} من مكتب الدعم (${supportOffice}) إلى مخزن مكتبه (${homeOffice}) — بقيت بذمّته`})`;
        });
        } catch (e) {
          transferFailed = true;
          console.error(`[endSupport] تعذّر ترحيل «${item.name}»×${c.qty} للفني ${technicianId}:`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      transferFailed = true;
      console.error(`[endSupport] تعذّرت قراءة ذمم الفني ${technicianId}:`, e instanceof Error ? e.message : e);
    }
  }
  // فشلَ ترحيلٌ ما ⇒ **لا يُصفَّر الدعم**: تبقى الحالة كما هي فتُعاد المحاولة في المرّة القادمة
  // (بصمة خروج / مهمّة ٠٠:١٥ / اكمال) بدل أن تضيع موادّ مكتب الدعم بذمّته بلا أثر.
  if (transferFailed) return;
  await prisma.technician.update({ where: { id: technicianId }, data: { supportTowerId: null, supportKind: null, supportCardIds: null } });
}

// ═════ الإجازةُ الزمنيّةُ المعتمدةُ ليومٍ — تُزيح حدَّ الدوام في حساب الخصم (طلبُ محمد) ═════
// تُقرأ عند كلّ حسابِ بصمةٍ (خروجُ الفنيّ · الخروجُ التلقائيّ · إغلاقُ المدير) فيسقط خصمُ
// الوقت المأذون به. و**لا حصّةَ ولا عدد**: إن وافق المديرُ حُسِبت، وإلّا فلا (نصُّ محمد).
// 🔒 والعزلُ ضمنيّ: بمعرّف الفنيّ ويومِه — ولا مدخلَ للمستخدم فيها.
export async function approvedTimeLeaveFor(
  technicianId: number, dayKey: string | null | undefined,
): Promise<{ startMin: number; endMin: number } | null> {
  if (!dayKey) return null;
  // متوسّط(٢٤) · كان `.catch(() => null)` يحوّل **فشلَ القاعدة** إلى «لا إجازة» — فيُخصَم
  // من راتب فنيٍّ وقتٌ أذن به المديرُ فعلاً. المالُ الخاطئ أسوأُ من فشلٍ صريح: تُعاد
  // المحاولةُ مرّةً، وفشلُ الثانية يُرمى عمداً (حسابٌ توقّف خيرٌ من راتبٍ منقوص).
  const q = () => prisma.leave.findFirst({
    where: { technicianId, dayKey, kind: "time", status: "approved", isDeleted: false },
    select: { startMin: true, endMin: true },
    orderBy: { id: "desc" },
  });
  let l;
  try { l = await q(); }
  catch { await new Promise((r) => setTimeout(r, 1000)); l = await q(); }
  return l?.startMin != null && l.endMin != null ? { startMin: l.startMin, endMin: l.endMin } : null;
}

// ═════ مجموعةُ لوحةِ الفنيين (sharedFieldWith) ═════
// مكتبٌ ثانويٌّ (Tower.sharedFieldWith=رئيسيّ) يشارك المكتبَ الرئيسيَّ **لوحةَ إدارة الفنيين
// الواحدة** — والمخزنُ والتفعيلاتُ والمالُ تبقى لكلّ مكتبه (عبر TaskCard.officeId). العزلُ:
// المشاركةُ **ضمن نفس الوكيل حصراً** (تُتحقَّق عند الكتابة + دفاعٌ في العمق هنا). null = لا مشاركة
// ⇒ يعود كلُّ شيءٍ إلى المعرّف نفسِه فيطابق سلوكَ اليوم حرفيّاً للمكاتب غير المُجمَّعة.

// المكتبُ صاحبُ **اللوحة** لهذا المكتب: يتبع sharedFieldWith إن كان سليماً (نفسُ الوكيل، هدفٌ
// رئيسيٌّ غيرُ محذوف، بلا سلسلة)، وإلّا المعرّفُ نفسُه. أساسُ كلّ حلٍّ أحاديِّ المكتب للّوحة.
export async function fieldBoardOffice(officeId: number | null): Promise<number | null> {
  if (officeId == null) return null;
  const self = await prisma.tower.findUnique({
    where: { id: officeId },
    select: { agentId: true, sharedFieldWith: true, isDeleted: true },
  });
  if (!self || self.isDeleted || self.sharedFieldWith == null) return officeId;
  const primary = await prisma.tower.findUnique({
    where: { id: self.sharedFieldWith },
    select: { agentId: true, isDeleted: true, sharedFieldWith: true },
  });
  // دفاعٌ في العمق: لا نتبع الرابطَ إلّا لهدفٍ ضمن **نفس الوكيل**، رئيسيٍّ (بلا سلسلة)، غيرِ محذوف
  if (!primary || primary.isDeleted || primary.agentId == null || primary.agentId !== self.agentId || primary.sharedFieldWith != null) {
    return officeId;
  }
  return self.sharedFieldWith;
}

// كلُّ مكاتب مجموعة اللوحة لهذا المكتب (الرئيسيّ + كلُّ ثانويّاته ضمن نفس الوكيل).
// للمكتب غير المُجمَّع: [نفسه] فقط ⇒ مطابقٌ لليوم. تُستعمل لعرض فنيّي المجموعة وبوّابات العمل.
export async function fieldGroupOffices(officeId: number | null): Promise<number[]> {
  if (officeId == null) return [];
  const boardOffice = await fieldBoardOffice(officeId);
  if (boardOffice == null) return [officeId];
  const primary = await prisma.tower.findUnique({ where: { id: boardOffice }, select: { agentId: true } });
  const secondaries = primary?.agentId != null
    ? await prisma.tower.findMany({
        where: { sharedFieldWith: boardOffice, isDeleted: false, agentId: primary.agentId },
        select: { id: true },
      })
    : [];
  return [...new Set([boardOffice, ...secondaries.map((s) => s.id)])];
}

// ═════ ترحيلُ الربط: يُستدعى عند جعل مكتبٍ ثانويّاً (sharedFieldWith: null → رئيسيّ) ═════
// بلا هذا يُيتَّم ما على لوحة الثانويّ القديمة: بطاقاتُه الحيّة تختفي من العرض (getOrCreateBoard
// صار يحلّه إلى لوحة الرئيسيّ). فننقل بطاقاتِه **الحيّة** (غير محذوفةٍ ولا مؤرشفة) إلى اللوحة
// المشتركة بأعمدةٍ مطابقةِ الاسم، ونختم officeId=الثانويّ. ونختم officeId=الرئيسيّ على بطاقات
// الرئيسيّ القديمة (officeId=null) كي يصحّ عزلُ عاملِ أودو بـofficeId على اللوحة المشتركة.
// أفضلُ جهدٍ (لا يُفشل حفظَ المكتب)، وذرّيٌّ بما يكفي: البطاقاتُ المؤرشفة/المحذوفة تبقى مرئيّةً
// عبر مسحِ المجموعة (towerId ∈ group) في مسارَي الأرشيف/المحذوفات فلا تحتاج نقلاً.
export async function migrateOfficeIntoFieldGroup(secondaryId: number, primaryId: number): Promise<void> {
  const primaryBoard = await getOrCreateBoard(primaryId); // رئيسيٌّ sharedFieldWith=null ⇒ لوحتُه نفسُها
  const oldBoard = await prisma.taskBoard.findFirst({ where: { towerId: secondaryId, isDeleted: false }, orderBy: { id: "asc" } });
  // ذرّيٌّ: إمّا يتمّ الترحيلُ كاملاً أو لا شيء — فلا بطاقةٌ حيّةٌ تبقى عالقةً على اللوحة القديمة
  // (تختفي من buildBoard الذي يعرضُ اللوحة المشتركة). timeout مرفوعٌ لمكتبٍ كثيرِ البطاقات.
  await prisma.$transaction(async (tx) => {
    // (١) ختمُ **كلّ** بطاقات الرئيسيّ القديمة officeId=null ⇒ الرئيسيّ (حيّةً ومؤرشفةً ومحذوفة):
    // الحيّةُ لعزل عامل أودو، والمؤرشفة/المحذوفةُ كي لا تختفي تحت فلتر المكتب في الأرشيف/المحذوفات.
    const pLists = await tx.taskList.findMany({ where: { boardId: primaryBoard.id, isDeleted: false }, select: { id: true } });
    if (pLists.length) {
      await tx.taskCard.updateMany({
        where: { listId: { in: pLists.map((l) => l.id) }, officeId: null },
        data: { officeId: primaryId },
      });
    }
    if (!oldBoard || oldBoard.id === primaryBoard.id) return;
    const oldLists = await tx.taskList.findMany({ where: { boardId: oldBoard.id, isDeleted: false } });
    // (٢) نقلُ بطاقات الثانويّ **الحيّة** من لوحته القديمة إلى اللوحة المشتركة (بأعمدةٍ مطابقةِ الاسم)
    for (const ol of oldLists) {
      const liveCards = await tx.taskCard.findMany({
        where: { listId: ol.id, isDeleted: false, archivedAt: null },
        select: { id: true, officeId: true }, orderBy: { position: "asc" },
      });
      if (!liveCards.length) continue;
      let target = await tx.taskList.findFirst({ where: { boardId: primaryBoard.id, name: ol.name, isDeleted: false }, orderBy: { position: "asc" } });
      if (!target) {
        const count = await tx.taskList.count({ where: { boardId: primaryBoard.id, isDeleted: false } });
        target = await tx.taskList.create({ data: { boardId: primaryBoard.id, name: ol.name, position: count, privateToAssignee: ol.privateToAssignee, timeTracked: ol.timeTracked } });
      }
      let pos = await tx.taskCard.count({ where: { listId: target.id, isDeleted: false } });
      for (const c of liveCards) {
        await tx.taskCard.update({
          where: { id: c.id },
          data: { listId: target.id, position: pos++, officeId: c.officeId ?? secondaryId },
        });
      }
    }
    // (٣) ختمُ ما بقيَ على لوحة الثانويّ القديمة (المؤرشفة/المحذوفة) officeId=null ⇒ الثانويّ —
    // فتبقى مرئيّةً تحت فلتر مكتبها في الأرشيف/المحذوفات (المسحُ بالمجموعة towerId ∈ group).
    if (oldLists.length) {
      await tx.taskCard.updateMany({
        where: { listId: { in: oldLists.map((l) => l.id) }, officeId: null },
        data: { officeId: secondaryId },
      });
    }
  }, { timeout: 20000 });
}

// لوحة المكتب (تُنشأ إن لم توجد) — لوحة واحدة لكل قيمة towerId، مع حلِّ مجموعة اللوحة:
// مكتبٌ ثانويٌّ يُصيَّر على لوحةِ مكتبه الرئيسيّ (فيتشاركان لوحةً فيزيائيّةً واحدة).
export async function getOrCreateBoard(towerId: number | null) {
  const boardOffice = await fieldBoardOffice(towerId);
  let board = await prisma.taskBoard.findFirst({
    where: { towerId: boardOffice ?? null, isDeleted: false },
    orderBy: { id: "asc" },
  });
  if (!board) {
    board = await prisma.taskBoard.create({ data: { name: "إدارة الفنيين", towerId: boardOffice ?? null } });
  }
  return board;
}
