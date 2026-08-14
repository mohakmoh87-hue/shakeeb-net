import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { agentOwnsBoard, agentOwnsList, canOperateList, canOperateOffice } from "@/lib/field";
import { ensureCardType } from "@/lib/fieldDefaults";

// ═════ أ-٢ · إدارةُ الأعمدة **للمستخدم أيضاً** لا للمدير وحده (حسمه محمد 2026-08-14) ═════
// «المستخدم يُنشئ ويُعدّل ويحذف ويُرتّب الأعمدة والبطاقات كما يشاء» — وسُئل عن الحذف فقال:
// «نعم يشمل الحذف أيضاً». فسقط شرطُ `field.manage` عن الإنشاء والتسمية والحذف و«محسوب
// بالوقت»، وبقيت القاعدةُ الحاكمة قاعدةَ **الكتابة على المكتب** نفسَها التي تحكم البطاقات:
// المديرُ على كلّ مكاتب وكيله، ومستخدمُ المكتب على مكتبه وحدَه (مشاهدةٌ لغيره) — عبر
// `canOperateOffice/List` فلا يتغيّر العزل قيدَ أنملة. والفنيّون لا يصلون أصلاً (جلستُهم
// ليست جلسةَ مستخدم ⇒ 401).

// إنشاء عمود جديد في اللوحة
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.boardId || !b?.name?.trim()) return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  const boardId = Number(b.boardId);
  if (!(await agentOwnsBoard(s, boardId))) return NextResponse.json({ error: "اللوحة لا تتبع حسابك" }, { status: 403 });
  const board = await prisma.taskBoard.findUnique({ where: { id: boardId }, select: { towerId: true } });
  if (!(await canOperateOffice(s, board?.towerId ?? null))) {
    return NextResponse.json({ error: "مشاهدة فقط — لا يمكنك الإضافة على مكتب آخر" }, { status: 403 });
  }
  const count = await prisma.taskList.count({ where: { boardId, isDeleted: false } });
  const created = await prisma.taskList.create({ data: { boardId, name: String(b.name).trim(), position: count, timeTracked: !!b.timeTracked } });
  // ربطٌ تلقائيّ: إنشاء عمودٍ جديد يُنشئ نوعه في «الأنواع والأوقات» بنفس الاسم (يتخطّى النظاميّة)
  await ensureCardType(s.agentId ?? null, created.name);
  return NextResponse.json(created, { status: 201 });
}

// تعديل عمود (الاسم/الترتيب/محسوب بالوقت) — لمن يكتب على مكتب العمود (أ-٢)
export async function PATCH(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const listId = Number(b.id);
  // عزل الوكيل ثمّ عزل المكتب (الكتابة على مكتب العمود)
  if (!(await agentOwnsList(s, listId))) return NextResponse.json({ error: "العمود لا يتبع حسابك" }, { status: 403 });
  if (!(await canOperateList(s, listId))) {
    return NextResponse.json({ error: "مشاهدة فقط — لا يمكنك التعديل على مكتب آخر" }, { status: 403 });
  }
  const data: { name?: string; position?: number; timeTracked?: boolean } = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.position === "number") data.position = b.position;
  if (typeof b.timeTracked === "boolean") data.timeTracked = b.timeTracked;
  const updated = await prisma.taskList.update({ where: { id: listId }, data });
  // تسميةٌ جديدة = نوعُ عمليّةٍ جديد (كإنشاء عمودٍ باسمٍ جديد تماماً) — والقديم يبقى لتاريخه
  if (data.name) await ensureCardType(s.agentId ?? null, data.name);
  return NextResponse.json(updated);
}

// حذف عمود (وبطاقاته) حذفاً منطقياً — لمن يكتب على مكتب العمود (أ-٢)
export async function DELETE(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  if (!(await agentOwnsList(s, id))) return NextResponse.json({ error: "العمود لا يتبع حسابك" }, { status: 403 });
  if (!(await canOperateList(s, id))) {
    return NextResponse.json({ error: "مشاهدة فقط — لا يمكنك الحذف على مكتب آخر" }, { status: 403 });
  }
  // ═════ أ-١٥/٣ · حذفُ العمود لا يبتلع عملاً غيرَ محصَّل (مُصلَحة 2026-08-14) ═════
  // كان يحذف **كلَّ** بطاقاته بلا استثناء — فبطاقةٌ أُنجزت ولم تُحصَّل بعد (`done` بلا
  // `settled`) تختفي بمالها، وبطاقةُ أودو المدفوعةُ يعيدها السحبُ بطاقةً جديدةً كأنّ العملَ
  // لم يحدث. ⇒ يُستثنى **المنجَزُ غيرُ المحصَّل** وما دُفع إلى أودو: يبقى ظاهراً في «المنجزة»
  // ليُحصَّل، ويُبلَّغ المستخدمُ بعددها بدل أن تضيع صامتةً.
  const keepWhere = { listId: id, isDeleted: false, OR: [{ done: true, settled: false }, { odooPushedAt: { not: null } }] };
  const kept = await prisma.taskCard.count({ where: keepWhere });
  await prisma.$transaction([
    prisma.taskCard.updateMany({
      where: { listId: id, NOT: { OR: [{ done: true, settled: false }, { odooPushedAt: { not: null } }] } },
      data: { isDeleted: true },
    }),
    prisma.taskList.update({ where: { id }, data: { isDeleted: true } }),
  ]);
  return NextResponse.json({
    ok: true, keptCards: kept,
    ...(kept ? { note: `أُبقيت ${kept} بطاقةً منجزةً لم تُحصَّل بعد — تجدها في «المنجزة»` } : {}),
  });
}
