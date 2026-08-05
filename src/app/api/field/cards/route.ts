import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentOwnsCard, agentOwnsList, appendCardHistory, canOperateCard, canOperateList, cardOfficeId, listOfficeId, resolveListActor } from "@/lib/field";
import { agentTowerIds } from "@/lib/guard";
import { autoAssignOn, pickAssignee, verifyManualAssignee } from "@/lib/autoAssign";

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
  // **عزل إلزامي**: معرّف الفني القادم من المتصفح يُتحقَّق منه (وكيل/مكتب/غير محذوف)،
  // و«اسم المنفّذ» يُشتقّ من صفّ الفني لا من العميل — كان يُقبل الاثنان بلا فحص إطلاقاً.
  const officeId = await listOfficeId(Number(b.listId));
  const agentTowers = actor.isTech ? [] : await agentTowerIds(actor.session ?? null);
  let technicianId: number | null = null;
  let assignee: string | null = null;
  if (actor.isTech) {
    technicianId = actor.technicianId; assignee = actor.name;
  } else if (b.technicianId != null) {
    const ok = await verifyManualAssignee(Number(b.technicianId), officeId, agentTowers);
    if (!ok) return NextResponse.json({ error: "الفني غير موجود أو لا يتبع هذا المكتب" }, { status: 400 });
    technicianId = ok.id; assignee = ok.name;
  }
  // التوزيع التلقائي: لا يعمل إلا للمستخدم/المدير على بطاقة **بلا فني** — الإسناد
  // اليدوي وبطاقة الفني لنفسه لا يُمَسّان أبداً. وأي تعثّر يُبتلع فلا يفشل الإنشاء.
  let autoNote: string | null = null;
  if (!actor.isTech && technicianId == null) {
    try {
      const kind = b.kind ? String(b.kind).trim() : "صيانة";
      if (await autoAssignOn(officeId, kind, actor.agentId)) {
        const picked = await pickAssignee(officeId, agentTowers);
        if (picked) { technicianId = picked.id; assignee = picked.name; autoNote = `توزيع تلقائي ← ${picked.name}`; }
        else autoNote = "توزيع تلقائي: لا يوجد فني مؤهّل الآن (حضور/إجازة) — البطاقة بلا فني";
      }
    } catch { /* لا يُفشل إنشاء البطاقة إطلاقاً */ }
  }
  // ===== بطاقة التوصيل: مبلغها يُثبَّت عند الإنشاء إلزاماً (قرار محمد 2026-08-05) =====
  // نفس قاعدة البطاقة المُنشأة من المشترك — كي لا يبقى بابٌ تُنشأ منه بطاقة توصيل بلا مبلغ
  // فيُسأل عنه الفني عند الإنجاز. والصفر جائز لكنه يُكتب صراحةً.
  const kindName = b.kind ? String(b.kind).trim() : "صيانة";
  const kindType = await prisma.cardType.findFirst({
    where: { name: kindName, isDeleted: false, agentId: actor.agentId ?? -1 },
    select: { deliveryOnly: true },
  });
  const isDeliveryKind = kindType?.deliveryOnly ?? kindName === "توصيل";
  let deliveryAmount: number | null = null;
  if (isDeliveryKind) {
    const n = b.amount == null || b.amount === "" ? NaN : Math.round(Number(b.amount));
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "مبلغ التوصيل مطلوب (اكتب 0 إن كان مجاناً)" }, { status: 400 });
    }
    if (n > 0 && n < 1000) {
      return NextResponse.json({ error: "مبلغ التوصيل لا يقل عن 1000 دينار (أو صفر للمجاني)" }, { status: 400 });
    }
    deliveryAmount = n;
  }

  const count = await prisma.taskCard.count({ where: { listId: Number(b.listId), isDeleted: false } });
  const created = await prisma.taskCard.create({
    data: {
      listId: Number(b.listId),
      title: String(b.title).trim(),
      position: count,
      // نوع البطاقة = اسم الفئة (CardType) كما اختاره المستخدم — لا يُقسَر إلى maintenance/delivery
      kind: kindName,
      amount: deliveryAmount,
      assignee,
      technicianId,
      dueDate: b.dueDate ? new Date(b.dueDate) : null,
      description: b.description ? String(b.description) : null,
      label: b.label ? String(b.label) : null,
    },
  });
  // أول حدث في سجل التغييرات: إنشاء البطاقة (تاريخه ووقته وفاعله)
  await appendCardHistory(created.id, actor.name ?? "مستخدم", "إنشاء البطاقة");
  if (autoNote) await appendCardHistory(created.id, "النظام", autoNote);
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
  // تغيير الفني: يُتحقَّق منه كما في الإنشاء، والاسم يُشتقّ من صفّه لا من العميل
  if ("technicianId" in b) {
    if (b.technicianId == null) { data.technicianId = null; data.assignee = null; }
    else {
      const office = await cardOfficeId(Number(b.id));
      const ok = await verifyManualAssignee(Number(b.technicianId), office, await agentTowerIds(s));
      if (!ok) return NextResponse.json({ error: "الفني غير موجود أو لا يتبع هذا المكتب" }, { status: 400 });
      data.technicianId = ok.id; data.assignee = ok.name;
    }
  }
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

  // تغيير الفئة ينقل البطاقة تلقائياً إلى عمود الفئة الجديدة (إن وُجد بنفس اللوحة)
  // كي لا تبقى في عمود فئتها القديمة. مطابقة الاسم بعد تطبيع المسافات، ثم بادئة (تنصيب/تنصيبات).
  if (typeof data.kind === "string" && typeof b.listId !== "number" && before && data.kind !== before.kind) {
    const curList = await prisma.taskList.findUnique({ where: { id: before.listId }, select: { boardId: true } });
    if (curList) {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const wanted = norm(data.kind);
      const lists = await prisma.taskList.findMany({
        where: { boardId: curList.boardId, isDeleted: false },
        select: { id: true, name: true },
      });
      const target =
        lists.find((l) => norm(l.name) === wanted) ??
        lists.find((l) => norm(l.name).startsWith(wanted) || wanted.startsWith(norm(l.name)));
      if (target && target.id !== before.listId) {
        data.listId = target.id;
        data.position = await prisma.taskCard.count({ where: { listId: target.id, isDeleted: false } });
      }
    }
  }
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
  // حذف بطاقة **منجزة ولم تُحصَّل** كان يُسقط مبلغها من تحصيل الفني بصمت، بينما
  // تبقى فاتورتها وقبضها في التقارير — فينقص التحصيل بلا سبب ظاهر (المرحلة ٨).
  const before = await prisma.taskCard.findUnique({
    where: { id },
    select: { done: true, settled: true, amount: true, subAmount: true, technicianId: true, title: true },
  });
  await prisma.taskCard.update({ where: { id }, data: { isDeleted: true } });
  await prisma.cardPhoto.deleteMany({ where: { cardId: id } });
  let droppedFromSettlement = 0;
  if (before?.done && !before.settled) {
    droppedFromSettlement = (before.amount ?? 0) + (before.subAmount ?? 0);
    if (droppedFromSettlement > 0) {
      const tech = before.technicianId != null
        ? await prisma.technician.findUnique({ where: { id: before.technicianId }, select: { name: true } })
        : null;
      await prisma.auditLog.create({
        data: {
          userId: s.userId,
          action: "DELETE_DONE_CARD", entity: "taskCard", entityId: String(id),
          details:
            "حذف بطاقة منجزة غير محصّلة (" + (before.title ?? id) + ") — ينقص تحصيل " +
            (tech?.name ?? "الفني") + " بمقدار " + droppedFromSettlement.toLocaleString("en-US") +
            " (مبيع " + (before.amount ?? 0).toLocaleString("en-US") + " + اشتراك " +
            (before.subAmount ?? 0).toLocaleString("en-US") + ") — وفاتورتها وقبضها يبقيان",
        },
      });
    }
  }

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
  // الواجهة تُبلّغ المستخدم بالمبلغ الذي سقط من التحصيل بدل أن يقع بصمت
  return NextResponse.json({ ok: true, droppedFromSettlement });
}
