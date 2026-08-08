import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { sameAgentTower } from "@/lib/guard";
import { getOrCreateBoard } from "@/lib/field";
import { STANDARD_OPS, isSystemList } from "@/lib/fieldDefaults";

export const dynamic = "force-dynamic";

// خيارات «عمليات» لمشترك = أعمدة لوحة **مكتبه** حصراً (عزل مكاتب — طلب محمد 2026-08-08)،
// لا كلّ أنواع الوكيل. والمدير كذلك: يرى أعمدة مكتب المشترك المعنيّ فقط.
// عزل الوكلاء: المكتب يجب أن يتبع وكيل المستخدم (sameAgentTower) — لا وصول لمكاتب وكيلٍ آخر.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const officeId = Number(new URL(request.url).searchParams.get("officeId"));
  if (!Number.isInteger(officeId) || officeId <= 0) return NextResponse.json({ error: "مكتب غير صحيح" }, { status: 400 });
  if (!(await sameAgentTower(session, officeId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  const board = await getOrCreateBoard(officeId);
  const lists = await prisma.taskList.findMany({
    where: { boardId: board.id, isDeleted: false },
    orderBy: { position: "asc" }, select: { name: true },
  });
  // مكتبٌ جديد/ناقص: ضمان الأعمدة القياسيّة الخمسة على لوحته
  const have = new Set(lists.map((l) => l.name.trim()));
  for (const op of STANDARD_OPS) {
    if (!have.has(op)) {
      const count = await prisma.taskList.count({ where: { boardId: board.id, isDeleted: false } });
      await prisma.taskList.create({ data: { boardId: board.id, name: op, position: count } });
      lists.push({ name: op });
    }
  }
  // الأعمدة النظاميّة (الغاء/مكتمل/تذاكر أودو) ليست عمليّات
  const ops = [...new Set(lists.map((l) => l.name.trim()).filter((n) => n && !isSystemList(n)))];
  return NextResponse.json({ ops });
}
