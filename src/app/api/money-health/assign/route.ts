import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { notify } from "@/lib/notify";
import { GUARD_LIST_NAME } from "@/lib/guardAssign";

// ═════════ 🎯 تكليفُ حالاتِ حارس المال (طلبُ محمد 2026-08-14) ═════════
//
// «أريد إمكانيّةَ إرسالِ أيّ حالةٍ أو مجموعةِ حالاتٍ إلى أيّ فنيٍّ أو مديرٍ أو مستخدمٍ
//  فتظهر له بالإشعارات لديه من أجل تكليفه بمراجعتها، أو يمكن وضعُها تكتاً لا يراه غيره
//  عدا المدير — أو يمكنك اختيارُ الطريقة المناسبة.»
//
// 🧭 **والطريقةُ المختارةُ تتبع كيف يعمل كلُّ طرفٍ فعلاً**، لا آليّةً واحدةً تُحشَر للجميع:
//   • **مستخدمٌ أو مدير** ⇒ إشعارٌ **موجَّهٌ إليه وحدَه** (`Notification.userId`). وكانت
//     الإشعاراتُ عامّةً للوكيل كلِّه، فأُضيف المُخاطَبُ و`null` تبقى «للجميع».
//   • **فنّي** ⇒ **بطاقةُ مهمّةٍ في لوحته** (`TaskCard`) — فهذه طريقةُ عمله الفعليّة ولا
//     يفتح صفحاتِ المال أصلاً؛ ومعها إشعارٌ باسمه للسجلّ.
//   • **والتكليفُ يُثبَّت على الحالة** بهويّتها (`checkKey`+`rowKey`) فيراه المديرُ على
//     الحالة («مُكلَّفٌ به فلان»)، ولا تُكلَّف مرّتَين، **ولا يرى أحدٌ تكليفَ غيره**.
//
// 🔒 والعزل: المُخاطَبُ يُصادَق عليه ضدّ **مستخدمي وكيلِ الجلسة وفنيّيه** — فلا يُكلَّف
//   مستخدمُ وكيلٍ آخرَ ولو أُرسل مُعرِّفُه يدويّاً.

/** GET — قائمةُ مَن يمكن تكليفُه: مستخدمو الوكيل وفنيّوه. */
export async function GET() {
  const g = await guard("finance.view");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const towers = await agentTowerIds(g.session);

  const [users, techs, towerRows] = await Promise.all([
    prisma.user.findMany({
      where: { agentId, isActive: true },
      select: { id: true, fullName: true, username: true, isAdmin: true, towerId: true },
      orderBy: [{ isAdmin: "desc" }, { id: "asc" }], take: 200,
    }),
    prisma.technician.findMany({
      where: { agentId, isDeleted: false },
      select: { id: true, name: true, towerId: true }, orderBy: { name: "asc" }, take: 300,
    }),
    prisma.tower.findMany({ where: { id: { in: towers } }, select: { id: true, name: true } }),
  ]);
  const tName = new Map(towerRows.map((t) => [t.id, t.name]));
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id, name: u.fullName || u.username, isAdmin: u.isAdmin,
      office: u.towerId != null ? (tName.get(u.towerId) ?? null) : null,
    })),
    technicians: techs.map((t) => ({
      id: t.id, name: t.name, office: t.towerId != null ? (tName.get(t.towerId) ?? null) : null,
    })),
  });
}

/** POST — تكليفٌ بحالةٍ أو بمجموعةِ حالات، أو ختمُ «راجعتُها». */
export async function POST(request: Request) {
  const g = await guard("finance.view");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? -1;
  const by = g.session?.fullName ?? g.session?.username ?? null;

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "assign");

  // ═══ ختمُ الإنجاز: يرفعه المديرُ عن الحالة بعد مراجعةِ المُكلَّف ═══
  if (action === "done") {
    const id = Number(body?.id) || 0;
    if (!id) return NextResponse.json({ error: "لا تكليفَ محدَّد" }, { status: 400 });
    const done = await prisma.guardAssignment.updateMany({
      where: { id, agentId, doneAt: null },
      data: { doneAt: new Date(), doneNote: String(body?.note ?? "").trim() || null },
    });
    return NextResponse.json({ ok: true, changed: done.count });
  }

  // ═══ سحبُ التكليف ═══
  if (action === "unassign") {
    const id = Number(body?.id) || 0;
    if (!id) return NextResponse.json({ error: "لا تكليفَ محدَّد" }, { status: 400 });
    // 🔒 الحذفُ بشرطِ الوكيل — لا بفحصٍ سابقٍ عليه
    const del = await prisma.guardAssignment.deleteMany({ where: { id, agentId } });
    return NextResponse.json({ ok: true, changed: del.count });
  }

  // ═══ التكليف ═══
  const cases: { checkKey: string; rowKey: string; title?: string; detail?: string; how?: string }[] =
    Array.isArray(body?.cases) ? body.cases : [];
  if (!cases.length) return NextResponse.json({ error: "لا حالاتٍ محدَّدة" }, { status: 400 });
  if (cases.length > 50) return NextResponse.json({ error: "أكثرُ من خمسين حالةً في تكليفٍ واحد" }, { status: 400 });
  const note = String(body?.note ?? "").trim();
  const toUserId = Number(body?.toUserId) || null;
  const toTechnicianId = Number(body?.toTechnicianId) || null;
  if (!toUserId && !toTechnicianId) return NextResponse.json({ error: "اختر المُكلَّف" }, { status: 400 });
  if (toUserId && toTechnicianId) return NextResponse.json({ error: "مُكلَّفٌ واحدٌ لا اثنان" }, { status: 400 });

  // 🔒 مصادقةُ المُخاطَب: من مستخدمي هذا الوكيل أو فنيّيه — وإلّا فتكليفٌ عابرٌ للوكلاء
  const towers = await agentTowerIds(g.session);
  let toName: string | null = null, techTowerId: number | null = null;
  if (toUserId) {
    const u = await prisma.user.findFirst({
      where: { id: toUserId, agentId }, select: { fullName: true, username: true },
    });
    if (!u) return NextResponse.json({ error: "المستخدمُ ليس من حسابك" }, { status: 404 });
    toName = u.fullName || u.username;
  } else if (toTechnicianId) {
    const t = await prisma.technician.findFirst({
      where: { id: toTechnicianId, agentId, isDeleted: false }, select: { name: true, towerId: true },
    });
    if (!t) return NextResponse.json({ error: "الفنيُّ ليس من حسابك" }, { status: 404 });
    toName = t.name; techTowerId = t.towerId;
  }

  // ═══ عنوانُ التكت ونصُّه (طلبُ محمد 2026-08-14) ═══
  // «التكتُ يكون عنوانُه **حالاتٌ حرجةٌ من المدير يجب اتّخاذُ إجراءٍ بها**، وعند فتح
  //  التكت **لكلّ حالةٍ تظهر كاملُ تفاصيلها**.»
  // فالعنوانُ ثابتٌ يُعرَف من أوّل نظرة، والتفاصيلُ كاملةٌ في المتن: ما الخلل · بالأرقام
  // · وطريقةُ حلّه. ولا يُختصَر شيءٌ — فمَن يُكلَّف يقرأ التكت وحدَه ولا يفتح لوحةَ المال.
  const TICKET_TITLE = "حالاتٌ حرجةٌ من المدير يجب اتّخاذُ إجراءٍ بها";
  const blocks = cases.map((x, i) => {
    const parts = [`━━━ ${i + 1}) ${x.title ?? x.checkKey}`];
    if (x.detail) parts.push(`التفاصيل: ${x.detail}`);
    if (x.how) parts.push(`طريقةُ الحلّ: ${x.how}`);
    return parts.join("\n");
  });
  const bodyText = [
    note ? `📝 من المدير: ${note}` : "",
    `عددُ الحالات: ${cases.length}`,
    "",
    ...blocks,
  ].filter(Boolean).join("\n").slice(0, 3800);
  const titleText = TICKET_TITLE;

  // ═══ الفنيُّ: بطاقةُ مهمّةٍ في لوحته — فهي طريقةُ عمله، ولا يفتح صفحاتِ المال ═══
  let taskCardId: number | null = null;
  if (toTechnicianId) {
    try {
      // أوّلُ عمودٍ في لوحةِ مكتبِ الفنيّ — ولا تُخلَق لوحةٌ جديدة.
      // 🔒 و`TaskBoard` معزولٌ **بالمكتب** لا بالوكيل وبلا علاقةٍ في السكيمة، فالعزلُ
      //    يُبنى على `agentTowerIds` صريحاً: لوحاتُ مكاتبِ هذا الوكيل وحدَها.
      // مجموعةُ اللوحة: يُحلُّ مكتبُ الفنيّ إلى مكتب لوحته المشتركة كي تظهر بطاقةُ الحارس على
      // الصفحة نفسِها التي يراها (غير المُجمَّع: يعود للمعرّف نفسِه).
      const { fieldBoardOffice } = await import("@/lib/field");
      const boardTower = techTowerId != null && towers.includes(techTowerId) ? await fieldBoardOffice(techTowerId) : null;
      const boards = await prisma.taskBoard.findMany({
        where: {
          isDeleted: false,
          towerId: boardTower != null ? boardTower : { in: towers },
        },
        select: { id: true },
      });
      // 🔒 **عمودٌ خاصٌّ للتكليفات** (طلبُ محمد): لا يرى ما فيه إلّا المديرُ أو الفنيُّ
      //   المعنيّ. يُنشأ مرّةً واحدةً لكلّ لوحةٍ في آخرها، و`privateToAssignee` هي الخاصيّة
      //   التي يقرأها مسارُ اللوحة فيحجب بطاقاتِه عن بقيّة الفنيّين والمستخدمين.
      const boardId = boards[0]?.id ?? null;
      let list: { id: number } | null = null;
      if (boardId != null) {
        list = await prisma.taskList.findFirst({
          where: { boardId, isDeleted: false, privateToAssignee: true },
          orderBy: { position: "asc" }, select: { id: true },
        });
        if (!list) {
          const last = await prisma.taskList.findFirst({
            where: { boardId }, orderBy: { position: "desc" }, select: { position: true },
          });
          list = await prisma.taskList.create({
            data: {
              boardId, name: GUARD_LIST_NAME,
              position: (last?.position ?? 0) + 1, privateToAssignee: true,
            },
            select: { id: true },
          });
        }
      }
      if (list) {
        const card = await prisma.taskCard.create({
          data: {
            listId: list.id, title: titleText.slice(0, 120),
            description: bodyText, technicianId: toTechnicianId, assignee: toName,
            officeId: techTowerId ?? null, // مكتبُ الفنيّ (بطاقةُ حارسٍ بلا أثرٍ ماليّ — للاتّساق)
            kind: "guard", label: "حارس المال",
          },
          select: { id: true },
        });
        taskCardId = card.id;
      }
    } catch (e) {
      // ⚠️ ولا يُفشل التكليفُ إن تعذّرت البطاقة: الإشعارُ والسجلُّ يبقيان، والتعذُّرُ يُكتَب
      console.error("[guard-assign] بطاقةُ الفنيّ:", e instanceof Error ? e.message : e);
    }
  }

  // ═══ تثبيتُ التكليف على كلّ حالة (الحَجزُ قبل الأثر: `skipDuplicates` فلا تُكلَّف مرّتَين) ═══
  const created = await prisma.guardAssignment.createMany({
    data: cases.map((x) => ({
      agentId, checkKey: String(x.checkKey), rowKey: String(x.rowKey),
      toUserId, toTechnicianId, toName, note: note || null, taskCardId, assignedBy: by,
    })),
    skipDuplicates: true,
  });

  // ═══ الإشعارُ الموجَّه — يظهر للمُخاطَب وحدَه ═══
  await notify({
    agentId, towerId: techTowerId, type: "guard-assign",
    title: titleText, body: bodyText,
    userId: toUserId, technicianId: toTechnicianId,
    url: "/manager-accounts",
  });

  await prisma.auditLog.create({
    data: {
      userId: g.session?.userId, action: "GUARD_ASSIGN", entity: "guardAssignment",
      entityId: cases.map((x) => x.rowKey).join(",").slice(0, 200),
      details: `تكليفُ ${toName ?? "؟"} بـ${cases.length} حالةً من حارس المال${note ? ` · «${note}»` : ""}` +
               `${taskCardId ? ` · بطاقة #${taskCardId}` : ""}`,
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true, assigned: created.count, skipped: cases.length - created.count,
    taskCardId, toName,
  });
}
