import { prisma } from "@/lib/prisma";
import { baghdadDayKey, baghdadMinutesOfDay } from "@/lib/attendance";

// ===== التوزيع التلقائي للبطاقات (2026-08-03) =====
// قواعد محمد الحاكمة:
//  • بوّابتان معاً: مفتاح المكتب (Tower.autoAssignEnabled) + بوّابة النوع (CardType.autoAssign).
//    النوع مملوك للوكيل لا للمكتب، فبوّابة النوع وحدها كانت ستُفعّل التوزيع على كل مكاتب الوكيل.
//  • الرصيف: فنيّو هذا المكتب + من يدعمه **يوماً كاملاً** فقط. (المكاتب الإضافية الدائمة
//    مستبعَدة بقرار صريح من محمد 2026-08-03.)
//  • لا تُسنَد بطاقة إلا لمن **بصم دخوله اليوم ولم يبصم خروجاً وليس في إجازة سارية**.
//  • يُختار صاحب العمل الأقل؛ وإن كان فنيّ واحد أخذ كل شيء.
//  • **لا تُمَسّ بطاقة عليها فني** — الإسناد اليدوي مقدَّس ولا يُعاد توزيعه أبداً.
//  • لا يوجد مؤهَّل؟ تُنشأ البطاقة بلا فني ولا تفشل العملية إطلاقاً.

// كل أعمدة كل لوحات المكتب (قد تتكرّر اللوحة للمكتب الواحد — بلا قيد تفرّد)
async function officeListIds(officeId: number): Promise<number[]> {
  const boards = await prisma.taskBoard.findMany({ where: { towerId: officeId, isDeleted: false }, select: { id: true } });
  if (!boards.length) return [];
  const lists = await prisma.taskList.findMany({
    where: { boardId: { in: boards.map((b) => b.id) }, isDeleted: false },
    select: { id: true },
  });
  return lists.map((l) => l.id);
}

// الرصيف: الفنيون المؤهَّلون لاستلام بطاقة في هذا المكتب الآن
export async function eligibleTechnicians(officeId: number | null, agentTowers: number[]): Promise<number[]> {
  if (officeId == null || !agentTowers.includes(officeId)) return []; // قيد صريح لا ضمني
  const techs = await prisma.technician.findMany({
    where: {
      isDeleted: false,
      OR: [{ towerId: officeId }, { supportTowerId: officeId, supportKind: "day" }],
    },
    select: { id: true, towerId: true, supportTowerId: true, supportKind: true },
  });

  const pool = techs.filter((t) => {
    // مكتبه الأصلي يجب أن يكون معروفاً وضمن وكيل هذا المكتب — يسدّ ثغرة towerId=null
    if (t.towerId == null || !agentTowers.includes(t.towerId)) return false;
    // دعم «بطاقات محدّدة»: مستبعَد — البطاقة الموزَّعة ليست ضمن تكليفه، وإنهاء دعمه
    // التلقائي بعد بطاقاته يجعلها غير مرئية لأحد (يتم صامت)
    if (t.supportKind === "cards" && t.supportTowerId === officeId) return false;
    // دعم «يوم كامل» في مكتب آخر: لا يرى مكتبه الأصلي أثناءه — فلا يُسنَد له فيه
    if (t.supportKind === "day" && t.supportTowerId != null && t.supportTowerId !== officeId) return false;
    return true;
  });
  if (!pool.length) return [];

  const ids = pool.map((t) => t.id);
  const dayKey = baghdadDayKey(new Date());

  // الحضور: بصم دخولاً اليوم ولم يبصم خروجاً
  const att = await prisma.attendance.findMany({
    where: { technicianId: { in: ids }, dayKey, checkIn: { not: null }, checkOut: null },
    select: { technicianId: true },
  });
  const present = new Set(att.map((a) => a.technicianId));
  if (!present.size) return [];

  // الإجازات المعتمَدة اليوم: يوم كامل ⇒ مستبعَد؛ زمنية ⇒ مستبعَد أثناءها فقط
  const nowMin = baghdadMinutesOfDay(new Date());
  const leaves = await prisma.leave.findMany({
    where: { technicianId: { in: [...present] }, status: "approved", isDeleted: false, dayKey },
    select: { technicianId: true, kind: true, startMin: true, endMin: true },
  });
  const onLeave = new Set<number>();
  for (const l of leaves) {
    if (l.kind === "day") { onLeave.add(l.technicianId); continue; }
    // زمنية بحدود ناقصة: لا نستبعد (فشل مفتوح — يُبقي الرصيف غير فارغ)
    if (l.startMin == null || l.endMin == null) continue;
    if (nowMin >= l.startMin && nowMin <= l.endMin) onLeave.add(l.technicianId);
  }
  return [...present].filter((id) => !onLeave.has(id));
}

// هل التوزيع التلقائي مفعَّل لهذا المكتب ولهذا النوع؟ (البوّابتان معاً)
export async function autoAssignOn(officeId: number | null, kind: string | null | undefined, agentId: number | null | undefined): Promise<boolean> {
  if (officeId == null || !kind?.trim()) return false;
  const office = await prisma.tower.findUnique({ where: { id: officeId }, select: { autoAssignEnabled: true } });
  if (!office?.autoAssignEnabled) return false;
  // مطابعة اسم النوع بتسامح (مسافات/حالة) — الأسماء يكتبها المستخدم بحرّية
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const types = await prisma.cardType.findMany({
    where: { isDeleted: false, agentId: agentId ?? -1 },
    select: { name: true, autoAssign: true },
  });
  return types.some((t) => norm(t.name) === norm(kind) && t.autoAssign);
}

// اختيار الفني: صاحب العمل الأقل بين المؤهَّلين (فضّ التعادل بأصغر معرّف — ثابت ومتوقَّع)
export async function pickAssignee(officeId: number | null, agentTowers: number[]): Promise<{ id: number; name: string } | null> {
  const pool = await eligibleTechnicians(officeId, agentTowers);
  if (!pool.length) return null;
  const listIds = await officeListIds(officeId!);
  // الحمل = بطاقات هذا المكتب المفتوحة فعلاً. **settled:false إلزامي**: البطاقة الملغاة
  // تبقى على اللوحة للأبد، فبدونه ينمو حمل الفني تراكمياً حتى يتوقف عن الاستلام نهائياً.
  const counts = listIds.length
    ? await prisma.taskCard.groupBy({
        by: ["technicianId"],
        where: {
          technicianId: { in: pool },
          listId: { in: listIds },
          done: false, settled: false, isDeleted: false, archivedAt: null,
        },
        _count: { _all: true },
      })
    : [];
  const load = new Map<number, number>(counts.map((c) => [c.technicianId as number, c._count._all]));
  let bestId = pool[0], bestLoad = load.get(pool[0]) ?? 0;
  for (const id of pool) {
    const l = load.get(id) ?? 0;
    if (l < bestLoad || (l === bestLoad && id < bestId)) { bestId = id; bestLoad = l; }
  }
  const t = await prisma.technician.findUnique({ where: { id: bestId }, select: { id: true, name: true } });
  return t ? { id: t.id, name: t.name } : null;
}

// توزيع البطاقات المعلّقة (التي وُلدت بلا فني — كبطاقات الليل قبل حضور أحد).
// تُستدعى لحظة بصمة دخول فنيّ: طلبٌ يقع كل صباح بالضرورة ⇒ صفر كلفة إضافية.
// لا تمسّ إلا ما لا فني له، وتُعيد عدد ما وُزِّع.
export async function distributePending(officeId: number | null, agentId: number | null): Promise<number> {
  if (officeId == null) return 0;
  const office = await prisma.tower.findUnique({ where: { id: officeId }, select: { autoAssignEnabled: true, agentId: true } });
  if (!office?.autoAssignEnabled) return 0;
  const agentTowers = await agentTowerIdsForAgent(office.agentId ?? agentId);
  const listIds = await officeListIds(officeId);
  if (!listIds.length) return 0;
  const pending = await prisma.taskCard.findMany({
    where: { listId: { in: listIds }, technicianId: null, done: false, settled: false, isDeleted: false, archivedAt: null },
    select: { id: true, kind: true },
    orderBy: { id: "asc" },
    take: 200, // سقف حماية
  });
  let n = 0;
  for (const c of pending) {
    if (!(await autoAssignOn(officeId, c.kind, office.agentId ?? agentId))) continue;
    const picked = await pickAssignee(officeId, agentTowers);
    if (!picked) break; // لا مؤهَّل ⇒ توقّف (الباقي يبقى معلّقاً)
    await prisma.taskCard.update({ where: { id: c.id }, data: { technicianId: picked.id, assignee: picked.name } });
    n++;
  }
  return n;
}

// مكاتب وكيلٍ بعينه (بلا جلسة — تُستدعى من مسار البصمة)
async function agentTowerIdsForAgent(agentId: number | null | undefined): Promise<number[]> {
  if (agentId == null) return [];
  const towers = await prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } });
  return towers.map((t) => t.id);
}

// التحقق من أهلية فنيٍّ اختاره المستخدم يدوياً لبطاقة في هذا المكتب.
// **العزل الحقيقي**: كان مسار الإسناد يقبل أي معرّف من المتصفح بلا فحص إطلاقاً —
// فيستطيع مستخدم وكيلٍ إسناد بطاقة لفنيّ وكيلٍ آخر (ثغرة اصطادها تدقيق 2026-08-03).
export async function verifyManualAssignee(
  technicianId: number, officeId: number | null, agentTowers: number[],
): Promise<{ id: number; name: string } | null> {
  if (officeId == null || !agentTowers.includes(officeId)) return null;
  const t = await prisma.technician.findUnique({
    where: { id: technicianId },
    select: { id: true, name: true, isDeleted: true, towerId: true, supportTowerId: true, extraTowerIds: true },
  });
  if (!t || t.isDeleted) return null;
  if (t.towerId == null || !agentTowers.includes(t.towerId)) return null; // يسدّ ثغرة towerId=null
  // الإسناد اليدوي أوسع من التوزيع التلقائي عمداً: يقبل المكاتب الإضافية الدائمة والدعم
  // بكل أنواعه — فالمدير يعرف ما يفعل؛ الممنوع فقط تجاوز حدود الوكيل والمكتب.
  const { parseExtraTowers } = await import("@/lib/field");
  const offices = new Set<number>([t.towerId, ...parseExtraTowers(t.extraTowerIds)]);
  if (t.supportTowerId != null) offices.add(t.supportTowerId);
  return offices.has(officeId) ? { id: t.id, name: t.name } : null;
}
