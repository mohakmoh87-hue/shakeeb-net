import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentOwnsCard, agentOwnsList, appendCardHistory, canOperateCard, canOperateList, resolveListActor } from "@/lib/field";

const VIEW_ONLY = { error: "مشاهدة فقط — لا يمكنك التعديل على مكتب آخر" };

// إنشاء بطاقة جديدة في عمود — مع خياراتها مباشرةً (فني، تاريخ، نوع، وصف).
// الفاعل: مستخدم المكتب/المدير (يختار الفني)، أو الفني نفسه (تُسنَد البطاقة إليه تلقائياً).
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  if (!b?.listId || !b?.title?.trim()) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  const auth = await resolveListActor(Number(b.listId));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const actor = auth.actor;
  // الفني: تُسنَد البطاقة إليه حصراً (لا يختار فنياً آخر). المستخدم: حسب اختياره.
  const technicianId = actor.isTech ? actor.technicianId : (b.technicianId != null ? Number(b.technicianId) : null);
  const assignee = actor.isTech ? actor.name : (b.assignee ? String(b.assignee) : null);
  const count = await prisma.taskCard.count({ where: { listId: Number(b.listId), isDeleted: false } });
  const created = await prisma.taskCard.create({
    data: {
      listId: Number(b.listId),
      title: String(b.title).trim(),
      position: count,
      // نوع البطاقة = اسم الفئة (CardType) كما اختاره المستخدم — لا يُقسَر إلى maintenance/delivery
      kind: b.kind ? String(b.kind).trim() : "صيانة",
      assignee,
      technicianId,
      dueDate: b.dueDate ? new Date(b.dueDate) : null,
      description: b.description ? String(b.description) : null,
      label: b.label ? String(b.label) : null,
    },
  });
  // أول حدث في سجل التغييرات: إنشاء البطاقة (تاريخه ووقته وفاعله)
  await appendCardHistory(created.id, actor.name ?? "مستخدم", "إنشاء البطاقة");
  return NextResponse.json(created, { status: 201 });
}

// تعديل بطاقة (المحتوى أو النقل بين الأعمدة/الترتيب)
export async function PATCH(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsCard(s, Number(b.id)))) return NextResponse.json({ error: "البطاقة لا تتبع حسابك" }, { status: 403 });
  if (!(await canOperateCard(s, Number(b.id)))) return NextResponse.json(VIEW_ONLY, { status: 403 });
  // عند النقل لعمود آخر: تحقّق أن العمود الهدف يتبع الوكيل أيضاً + يجوز الكتابة عليه
  if (typeof b.listId === "number" && !(await agentOwnsList(s, b.listId))) return NextResponse.json({ error: "العمود الهدف لا يتبع حسابك" }, { status: 403 });
  if (typeof b.listId === "number" && !(await canOperateList(s, b.listId))) return NextResponse.json(VIEW_ONLY, { status: 403 });
  const data: Record<string, unknown> = {};
  if (typeof b.title === "string") data.title = b.title.trim();
  if ("description" in b) data.description = b.description || null;
  if ("assignee" in b) data.assignee = b.assignee || null;
  if ("technicianId" in b) data.technicianId = b.technicianId != null ? Number(b.technicianId) : null;
  if ("kind" in b && b.kind) data.kind = String(b.kind).trim();
  if ("label" in b) data.label = b.label || null;
  if ("dueDate" in b) data.dueDate = b.dueDate ? new Date(b.dueDate) : null;
  if (typeof b.listId === "number") data.listId = b.listId;
  if (typeof b.position === "number") data.position = b.position;
  // ملاحظة: الإنجاز (done=true) يتمّ عبر /api/field/complete فقط (بحقوله الواجبة)
  if (b.done === false) {
    data.done = false; data.completedAt = null;
    // إلغاء الإنجاز يلغي آخر سجل إنجاز دائم للبطاقة (كي لا يُعدّ في كشف الراتب)
    const lastComp = await prisma.cardCompletion.findFirst({ where: { cardId: Number(b.id) }, orderBy: { id: "desc" }, select: { id: true } });
    if (lastComp) await prisma.cardCompletion.delete({ where: { id: lastComp.id } }).catch(() => {});
  }

  // الحالة القديمة قبل التعديل — لتسجيل التغييرات المهمّة في سجل البطاقة
  const before = await prisma.taskCard.findUnique({
    where: { id: Number(b.id) },
    select: { technicianId: true, assignee: true, listId: true, dueDate: true, kind: true, done: true },
  });
  const updated = await prisma.taskCard.update({ where: { id: Number(b.id) }, data });

  // سجل التغييرات داخل البطاقة (تغيير الفني / نقل عمود / الموعد / النوع / إلغاء الإنجاز)
  if (before) {
    const by = s.fullName ?? s.username;
    const events: string[] = [];
    if ("technicianId" in data && before.technicianId !== updated.technicianId) {
      events.push(`تغيير الفني من «${before.assignee ?? "بلا فني"}» إلى «${updated.assignee ?? "بلا فني"}»`);
    }
    if ("listId" in data && before.listId !== updated.listId) {
      const [fromL, toL] = await Promise.all([
        prisma.taskList.findUnique({ where: { id: before.listId }, select: { name: true } }),
        prisma.taskList.findUnique({ where: { id: updated.listId }, select: { name: true } }),
      ]);
      events.push(`نقل البطاقة من عمود «${fromL?.name ?? before.listId}» إلى «${toL?.name ?? updated.listId}»`);
    }
    if ("dueDate" in data && String(before.dueDate ?? "") !== String(updated.dueDate ?? "")) {
      const fmt = (d: Date | null) => (d ? d.toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit" }) : "بلا موعد");
      events.push(`تغيير الموعد من ${fmt(before.dueDate)} إلى ${fmt(updated.dueDate)}`);
    }
    if ("kind" in data && before.kind !== updated.kind) events.push(`تغيير النوع من «${before.kind}» إلى «${updated.kind}»`);
    if (b.done === false && before.done) events.push("إلغاء الإنجاز (أُعيدت للانتظار)");
    for (const text of events) await appendCardHistory(Number(b.id), by, text);
  }
  return NextResponse.json(updated);
}

// حذف بطاقة حذفاً منطقياً — مع حذف صورتها فعلياً من القاعدة (تفريغ مساحة الاستضافة)
export async function DELETE(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsCard(s, id))) return NextResponse.json({ error: "البطاقة لا تتبع حسابك" }, { status: 403 });
  if (!(await canOperateCard(s, id))) return NextResponse.json(VIEW_ONLY, { status: 403 });
  await prisma.taskCard.update({ where: { id }, data: { isDeleted: true } });
  await prisma.cardPhoto.deleteMany({ where: { cardId: id } });

  // إن كانت من بطاقات دعمٍ مؤقت: أعد فحص «اكتملت كل بطاقات الدعم» — وإلا يعلق الدعم بعد حذف بطاقة
  try {
    const supTechs = await prisma.technician.findMany({
      where: { isDeleted: false, supportKind: "cards", supportCardIds: { not: null } },
      select: { id: true, name: true, agentId: true, towerId: true, supportCardIds: true },
    });
    for (const t of supTechs) {
      let ids: number[] = [];
      try { ids = JSON.parse(t.supportCardIds ?? "[]") as number[]; } catch { continue; }
      if (!ids.includes(id)) continue;
      const remaining = await prisma.taskCard.count({ where: { id: { in: ids }, done: false, isDeleted: false } });
      if (remaining === 0) {
        const { endSupport } = await import("@/lib/field");
        await endSupport(t.id);
        const { notify } = await import("@/lib/notify");
        void notify({ agentId: t.agentId, towerId: t.towerId, type: "checkout", title: "انتهاء الدعم", body: `${t.name} انتهت بطاقات دعمه وعاد لمكتبه`, refType: "technician", refId: t.id });
      }
    }
  } catch { /* لا يُفشل الحذف */ }
  return NextResponse.json({ ok: true });
}
